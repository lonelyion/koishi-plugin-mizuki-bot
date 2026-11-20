import { Context } from 'koishi';
import { getLocalDateKey, getOrCreateDailyState } from '../arknights/fortune';
import { Config } from '../config';
import { Jellyfish, JellyfishBox, JellyfishMeta } from '../database';
import { randomChoice, randomChoiceWeighted, RandomFn } from '../utils/random';
import { MAX_JELLYFISH_COUNT } from './constants';
import {
  boxLock,
  getJellyfishCount,
  getOrCreateJellyfishBox,
  JellyfishBoxEvent
} from './service';

export type DishFlavor = 'warm' | 'cold' | 'salty';
export type DishQuality = 'masterpiece' | 'tasty' | 'chaotic';

export interface DishDefinition {
  name: string;
  flavor: DishFlavor;
  tempDelta: number;
  salinityDelta: number;
  description: string;
}

export const MAX_DAILY_FEEDS = 2;
const MIN_TEMP = 15;
const MAX_TEMP = 35;
const MIN_SALINITY = 15;
const MAX_SALINITY = 40;

const FLAVOR_ALIASES: Record<string, DishFlavor> = {
  warm: 'warm',
  hot: 'warm',
  暖汤: 'warm',
  热汤: 'warm',
  升温: 'warm',
  cold: 'cold',
  ice: 'cold',
  冰沙: 'cold',
  冷饮: 'cold',
  降温: 'cold',
  salty: 'salty',
  secret: 'salty',
  秘制: 'salty',
  海盐: 'salty',
  调盐: 'salty'
};

const DISHES: readonly DishDefinition[] = [
  { name: '源石虫暖胃浓汤', flavor: 'warm', tempDelta: 2, salinityDelta: 0, description: '水月用小火慢炖的鲜美浓汤，水箱变得暖洋洋的。' },
  { name: '汐斯塔辣味烤触手', flavor: 'warm', tempDelta: 3, salinityDelta: 1, description: '热情似火的庞贝风味烤串，水母们围着泡泡直打转。' },
  { name: '深蓝冰晶海月沙冰', flavor: 'cold', tempDelta: -2, salinityDelta: 0, description: '清凉透心的海月风味刨冰，让水箱瞬间清爽了起来。' },
  { name: '萨米碎冰冻鱼块', flavor: 'cold', tempDelta: -3, salinityDelta: -1, description: '冰冰凉凉的脆爽小点，适合精力过剩的水母降降温。' },
  { name: '水月特调海盐天妇罗', flavor: 'salty', tempDelta: 0, salinityDelta: 3, description: '外酥里嫩的秘制天妇罗，咸鲜香气飘满整个水母箱。' },
  { name: '阿戈尔清爽贝柱盖饭', flavor: 'salty', tempDelta: 0, salinityDelta: -3, description: '带着淡雅海风味的鲜甜贝柱，把过咸的海水调得刚刚好。' }
];

export type FeedBoxResult =
  | { ok: false; reason: string }
  | {
    ok: true;
    box: JellyfishBox;
    dish: DishDefinition;
    quality: DishQuality;
    added?: Jellyfish;
    events: JellyfishBoxEvent[];
    remainingIngredients: number;
    feedsUsedToday: number;
    allMeta: JellyfishMeta[];
  };

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

export function resolveDishFlavor(input?: string): DishFlavor | undefined {
  if (!input) return undefined;
  return FLAVOR_ALIASES[input.trim().toLowerCase()];
}

export async function feedJellyfishBox(
  ctx: Context,
  config: Config,
  userId: string,
  platform: string,
  flavorInput?: string,
  now: Date = new Date(),
  rng: RandomFn = Math.random
): Promise<FeedBoxResult> {
  if (flavorInput && !resolveDishFlavor(flavorInput)) {
    return {
      ok: false,
      reason: '未识别的口味~ 可选口味：「暖汤」（升温）、「冰沙」（降温）、「秘制」（调盐度），或直接发送「投喂」由水月自由发挥！'
    };
  }

  return boxLock.run(`${platform}:${userId}`, async () => {
    const box = await getOrCreateJellyfishBox(ctx, userId, platform);
    const state = await getOrCreateDailyState(ctx, box.user_id);
    const dateKey = getLocalDateKey(now);
    const isTestAccount = userId === config.test_account;

    const feedsToday = state.last_feed_date === dateKey ? state.feed_count_today : 0;
    if (!isTestAccount && feedsToday >= MAX_DAILY_FEEDS) {
      return {
        ok: false,
        reason: `水母们今天已经吃得圆滚滚啦（每日最多投喂 ${MAX_DAILY_FEEDS} 次），明天再来找水月开火吧！`
      };
    }

    if (!isTestAccount && state.ingredients <= 0) {
      return {
        ok: false,
        reason: '厨房里没有深海食材啦！每天发送「今日运势」即可领取 2~3 份深海食材~'
      };
    }

    const allMeta = await ctx.database.get('mzk_jellyfish_meta', {});
    if (allMeta.length === 0) {
      return { ok: false, reason: '水母图鉴数据尚未加载完成，请稍后再试' };
    }

    const requestedFlavor = resolveDishFlavor(flavorInput);
    const dishPool = requestedFlavor ? DISHES.filter((d) => d.flavor === requestedFlavor) : DISHES;
    const dish = randomChoice(dishPool, rng);

    // 调节水箱温盐度
    const nextTemp = clamp(Math.round((box.temperature ?? 25) + dish.tempDelta), MIN_TEMP, MAX_TEMP);
    const nextSalinity = clamp(Math.round((box.salinity ?? 25) + dish.salinityDelta), MIN_SALINITY, MAX_SALINITY);
    box.temperature = nextTemp;
    box.salinity = nextSalinity;

    // 舒适温盐度区间（22~28°C 且 22~30‰）提高出特级料理的概率
    const isCozyEnv = nextTemp >= 22 && nextTemp <= 28 && nextSalinity >= 22 && nextSalinity <= 30;
    const quality = randomChoiceWeighted<DishQuality>(
      isCozyEnv ? [0.28, 0.60, 0.12] : [0.18, 0.67, 0.15],
      ['masterpiece', 'tasty', 'chaotic'],
      rng
    );

    const events: JellyfishBoxEvent[] = [
      {
        id: 'kitchen_dish',
        name: `水月厨房 · ${dish.name}`,
        description: `${dish.description}（当前环境：${nextTemp}°C · 盐度 ${nextSalinity}‰）`
      }
    ];

    const metaMap = new Map(allMeta.map((m) => [m.id, m]));
    let added: Jellyfish | undefined;
    const totalCount = getJellyfishCount(box.jellyfish);

    if (quality === 'masterpiece') {
      // 特级料理：吸引一只新水母游进水箱（偏向 good/great 稀有度）
      if (totalCount < MAX_JELLYFISH_COUNT) {
        const preferred = allMeta.filter((m) => m.group === 'great' || m.group === 'good');
        const chosen = randomChoice(preferred.length > 0 ? preferred : allMeta, rng);
        const existingIdx = box.jellyfish.findIndex((j) => j.id === chosen.id);
        if (existingIdx === -1) {
          box.jellyfish.push({ id: chosen.id, number: 1 });
        } else {
          box.jellyfish[existingIdx].number += 1;
        }
        added = { id: chosen.id, number: 1 };
        events.push({
          id: 'kitchen_masterpiece',
          name: '特级料理大成功！',
          description: `香气飘出了十海里，竟然把一只野生的「${chosen.name}」馋进了你的水母箱！`
        });
      } else {
        events.push({
          id: 'kitchen_masterpiece',
          name: '特级料理大成功！',
          description: '水母们吃得超级满足（箱子已经满员啦，快放生几只腾腾位置吧）'
        });
      }
    } else if (quality === 'tasty') {
      // 美味料理：箱内有水母则随机 1 种 +1；空箱则吸引 2 只普通水母
      if (box.jellyfish.length > 0 && totalCount < MAX_JELLYFISH_COUNT) {
        const candidates = box.jellyfish.filter((j) => j.number > 0 && metaMap.has(j.id));
        const lucky = randomChoice(candidates.length > 0 ? candidates : box.jellyfish, rng);
        lucky.number += 1;
        const luckyName = metaMap.get(lucky.id)?.name ?? lucky.id;
        added = { id: lucky.id, number: 1 };
        events.push({
          id: 'kitchen_tasty',
          name: '水母吃饱喝足',
          description: `「${luckyName}」吃得开心极了，顺手分裂出了 1 只新伙伴！`
        });
      } else if (box.jellyfish.length === 0) {
        const normals = allMeta.filter((m) => m.group === 'normal');
        const chosen = randomChoice(normals.length > 0 ? normals : allMeta, rng);
        box.jellyfish.push({ id: chosen.id, number: 2 });
        added = { id: chosen.id, number: 2 };
        events.push({
          id: 'kitchen_tasty',
          name: '香气引来新客人',
          description: `原本空荡荡的水母箱飘出饭香，2 只「${chosen.name}」闻着味游了进来！`
        });
      } else {
        events.push({
          id: 'kitchen_tasty',
          name: '水母吃饱喝足',
          description: '水母箱已经满满当当，大家美美地蹭了一顿大餐！'
        });
      }
    } else {
      // 黑暗料理（海嗣风味）：搞笑彩蛋 + 缩短抓水母冷却 30 分钟，绝不扣水母！
      const nextCatch = new Date(new Date(box.last_catch_time).getTime() - 30 * 60 * 1000);
      box.last_catch_time = nextCatch;
      events.push({
        id: 'kitchen_chaotic',
        name: '黑暗料理（海嗣风味）',
        description: '水月悄悄加了一勺神秘海嗣调味粉！水母们吐着泡泡精神百倍，你的抓水母冷却缩短了 30 分钟！'
      });
    }

    const remainingIngredients = isTestAccount ? state.ingredients : Math.max(0, state.ingredients - 1);
    const nextFeedsUsed = feedsToday + 1;

    await Promise.all([
      ctx.database.set('mzk_jellyfish_box', box.user_id, {
        jellyfish: box.jellyfish,
        temperature: box.temperature,
        salinity: box.salinity,
        last_catch_time: box.last_catch_time
      }),
      ctx.database.set('mzk_daily_state', box.user_id, {
        ingredients: remainingIngredients,
        last_feed_date: dateKey,
        feed_count_today: nextFeedsUsed
      })
    ]);

    return {
      ok: true,
      box,
      dish,
      quality,
      added,
      events,
      remainingIngredients,
      feedsUsedToday: nextFeedsUsed,
      allMeta
    };
  });
}
