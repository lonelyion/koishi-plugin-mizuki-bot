import { Context } from 'koishi';
import { MzkDailyState } from '../database';
import { boxLock } from '../jellyfish/service';
import { CATCH_COOLDOWN_MS } from '../jellyfish/constants';
import { getOrCreateUser } from '../utils/user';
import {
  FORTUNE_BAD_THINGS,
  FORTUNE_GOOD_THINGS,
  FortuneRelic,
  MIZUKI_RELICS
} from './constants';
import { loadCharacterSkins, loadPlayableOperators, OperatorProfile } from './data';
import { CharacterSkin } from './types';

export interface FortuneTier {
  id: string;
  title: string;
  badge: string;
  accentColor: string;
  weight: number;
  lampRange: readonly [number, number];
  ingredientReward: number;
  cooldownBonusMinutes: number;
}

export const FORTUNE_TIERS: readonly FortuneTier[] = [
  { id: 'great_luck', title: '灯火通明', badge: '大吉', accentColor: '#f5b841', weight: 14, lampRange: [88, 100], ingredientReward: 3, cooldownBonusMinutes: 60 },
  { id: 'good_luck', title: '海流顺遂', badge: '中吉', accentColor: '#34c77b', weight: 22, lampRange: [72, 87], ingredientReward: 2, cooldownBonusMinutes: 30 },
  { id: 'small_luck', title: '微光摇曳', badge: '小吉', accentColor: '#4cc9f0', weight: 24, lampRange: [56, 71], ingredientReward: 2, cooldownBonusMinutes: 30 },
  { id: 'neutral', title: '风平浪静', badge: '平', accentColor: '#94a3b8', weight: 18, lampRange: [42, 55], ingredientReward: 2, cooldownBonusMinutes: 20 },
  { id: 'late_luck', title: '海雾迷蒙', badge: '末吉', accentColor: '#a78bfa', weight: 10, lampRange: [30, 41], ingredientReward: 2, cooldownBonusMinutes: 20 },
  { id: 'small_bad', title: '灯火摇晃', badge: '小凶', accentColor: '#fb923c', weight: 7, lampRange: [18, 29], ingredientReward: 2, cooldownBonusMinutes: 15 },
  { id: 'rejection', title: '排异反应', badge: '大凶', accentColor: '#f87171', weight: 5, lampRange: [6, 17], ingredientReward: 3, cooldownBonusMinutes: 45 }
];

export interface DailyFortune {
  dateKey: string;
  tier: FortuneTier;
  lampValue: number;
  guardian: {
    charId: string;
    name: string;
    detail: string;
    avatarId: string;
    skinLabel: string;
  };
  relic: FortuneRelic;
  goodThings: [string, string];
  badThings: [string, string];
}

export interface DrawFortuneResult {
  fortune: DailyFortune;
  isFirstToday: boolean;
  ingredientsGranted: number;
  totalIngredients: number;
  cooldownReducedMinutes: number;
}

export function getLocalDateKey(now: Date = new Date()): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function hashSeed(input: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function createSeededRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pickDistinctPair<T>(items: readonly T[], rng: () => number): [T, T] {
  const firstIdx = Math.floor(rng() * items.length);
  let secondIdx = Math.floor(rng() * (items.length - 1));
  if (secondIdx >= firstIdx) secondIdx += 1;
  return [items[firstIdx], items[secondIdx]];
}

function formatSkinLabel(skin: CharacterSkin): string {
  const groupName = skin.displaySkin?.skinGroupName?.trim();
  if (groupName && groupName !== '默认服装') {
    return skin.displaySkin?.skinName?.trim() || groupName;
  }
  if (skin.skinId.endsWith('#2')) return '精英二';
  return '默认立绘';
}

/**
 * 基于确定性种子生成今日水月深海运势（纯函数，同一天重复查询结果一致）。
 */
export function generateDailyFortune(
  seed: number,
  dateKey: string,
  operators: readonly OperatorProfile[],
  skins: readonly CharacterSkin[] = []
): DailyFortune {
  const rng = createSeededRng(seed);

  const totalWeight = FORTUNE_TIERS.reduce((sum, t) => sum + t.weight, 0);
  let roll = rng() * totalWeight;
  let tier = FORTUNE_TIERS[0];
  for (const candidate of FORTUNE_TIERS) {
    roll -= candidate.weight;
    if (roll < 0) {
      tier = candidate;
      break;
    }
  }

  const [minLamp, maxLamp] = tier.lampRange;
  const lampValue = minLamp + Math.floor(rng() * (maxLamp - minLamp + 1));

  let guardian = {
    charId: 'char_437_mizuki',
    name: '水月',
    detail: '6★ 特种 · 伏击客',
    avatarId: 'char_437_mizuki',
    skinLabel: '默认立绘'
  };
  if (operators.length > 0) {
    const op = operators[Math.floor(rng() * operators.length)];
    const opSkins = skins.filter((s) => s.charId === op.id && Boolean(s.avatarId));
    const chosenSkin = opSkins.length > 0 ? opSkins[Math.floor(rng() * opSkins.length)] : undefined;
    guardian = {
      charId: op.id,
      name: op.name,
      detail: `${op.rarity}★ ${op.professionName} · ${op.subProfessionName}`,
      avatarId: chosenSkin?.avatarId ?? op.id,
      skinLabel: chosenSkin ? formatSkinLabel(chosenSkin) : '默认立绘'
    };
  }

  const relic = MIZUKI_RELICS[Math.floor(rng() * MIZUKI_RELICS.length)];
  const goodThings = pickDistinctPair(FORTUNE_GOOD_THINGS, rng);
  const badThings = pickDistinctPair(FORTUNE_BAD_THINGS, rng);

  return {
    dateKey,
    tier,
    lampValue,
    guardian,
    relic,
    goodThings,
    badThings
  };
}

export async function getOrCreateDailyState(ctx: Context, dbUserId: number): Promise<MzkDailyState> {
  const existing = await ctx.database.get('mzk_daily_state', { user_id: dbUserId });
  if (existing.length > 0) return existing[0];

  try {
    return await ctx.database.create('mzk_daily_state', {
      user_id: dbUserId,
      last_fortune_date: '',
      fortune_seed: 0,
      ingredients: 0,
      last_feed_date: '',
      feed_count_today: 0
    });
  } catch (error) {
    const retry = await ctx.database.get('mzk_daily_state', { user_id: dbUserId });
    if (retry.length > 0) return retry[0];
    throw error;
  }
}

export async function drawDailyFortune(
  ctx: Context,
  userId: string,
  platform: string,
  now: Date = new Date()
): Promise<DrawFortuneResult> {
  return boxLock.run(`${platform}:${userId}`, async () => {
    const user = await getOrCreateUser(ctx, userId, platform);
    const state = await getOrCreateDailyState(ctx, user.id);
    const [operators, skins] = await Promise.all([
      loadPlayableOperators(ctx),
      loadCharacterSkins(ctx)
    ]);
    const dateKey = getLocalDateKey(now);

    const isFirstToday = state.last_fortune_date !== dateKey;
    const seed = isFirstToday
      ? hashSeed(`mizuki-fortune:${platform}:${userId}:${dateKey}`)
      : state.fortune_seed || hashSeed(`mizuki-fortune:${platform}:${userId}:${dateKey}`);

    const fortune = generateDailyFortune(seed, dateKey, operators, skins);

    let ingredientsGranted = 0;
    let cooldownReducedMinutes = 0;
    let totalIngredients = state.ingredients;

    if (isFirstToday) {
      ingredientsGranted = fortune.tier.ingredientReward;
      totalIngredients = state.ingredients + ingredientsGranted;
      await ctx.database.set('mzk_daily_state', user.id, {
        last_fortune_date: dateKey,
        fortune_seed: seed,
        ingredients: totalIngredients
      });

      // 若玩家水母箱当前处于抓水母冷却期，顺便减免冷却时间
      const boxes = await ctx.database.get('mzk_jellyfish_box', { user_id: user.id });
      if (boxes.length > 0) {
        const box = boxes[0];
        const lastCatchMs = new Date(box.last_catch_time).getTime();
        const remainingMs = lastCatchMs + CATCH_COOLDOWN_MS - now.getTime();
        if (remainingMs > 0) {
          const bonusMs = fortune.tier.cooldownBonusMinutes * 60 * 1000;
          const nextLastCatch = new Date(lastCatchMs - bonusMs);
          await ctx.database.set('mzk_jellyfish_box', user.id, {
            last_catch_time: nextLastCatch
          });
          cooldownReducedMinutes = Math.min(fortune.tier.cooldownBonusMinutes, Math.ceil(remainingMs / 60_000));
        }
      }
    }

    return {
      fortune,
      isFirstToday,
      ingredientsGranted,
      totalIngredients,
      cooldownReducedMinutes
    };
  });
}
