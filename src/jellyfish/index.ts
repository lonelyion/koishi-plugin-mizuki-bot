import { Context, h, Logger } from 'koishi';
import { Config } from '../config';
import { resolveSessionUserId } from '../utils/user';
import { feedJellyfishBox, MAX_DAILY_FEEDS } from './kitchen';
import { renderJellyfishBox, renderJellyfishStatistics } from './renderer';
import {
  catchJellyfish,
  dropJellyfish,
  getOrCreateJellyfishBox,
  setJellyfishBoxStyle,
  viewJellyfishBox
} from './service';

const logger = new Logger('mizuki-bot-jellyfish');

export function registerJellyfishCommands(ctx: Context, config: Config) {
  ctx.command('水母箱', '查看你的水母箱')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      const uid = resolveSessionUserId(session);
      if (!uid) return '无法获取你的用户信息，请稍后再试';

      const { box, events, allMeta } = await viewJellyfishBox(ctx, config, uid, session.platform);
      const buffer = await renderJellyfishBox({
        ctx,
        config,
        session,
        jellyfishBox: box,
        allMeta,
        events
      });
      return h.image(buffer, 'image/png');
    });

  ctx.command('水母箱.抓水母', '抓几只水母放进水母箱')
    .alias('抓水母')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      const uid = resolveSessionUserId(session);
      if (!uid) return '无法获取你的用户信息，请稍后再试';

      const result = await catchJellyfish(ctx, config, uid, session.platform);
      if (!result.ok) {
        return result.reason;
      }

      logger.info(`用户 ${uid} 在 ${session.platform} 抓到了 ${result.added.number} 只 ${result.addedMeta.name}`);

      const allMeta = await ctx.database.get('mzk_jellyfish_meta', {});
      const buffer = await renderJellyfishBox({
        ctx,
        config,
        session,
        jellyfishBox: result.box,
        allMeta,
        newJelly: result.added,
        events: result.events,
        isCatch: true
      });
      return h.image(buffer, 'image/png');
    });

  ctx.command('水母箱.统计', '查看水母箱内各类水母数量统计')
    .alias('水母统计表')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      const uid = resolveSessionUserId(session);
      if (!uid) return '无法获取你的用户信息，请稍后再试';

      const [box, allMeta] = await Promise.all([
        getOrCreateJellyfishBox(ctx, uid, session.platform),
        ctx.database.get('mzk_jellyfish_meta', {})
      ]);

      if (box.jellyfish.length === 0) {
        return '你的水母箱里还没有水母，快发送「抓水母」试试吧！';
      }

      const buffer = await renderJellyfishStatistics({
        ctx,
        config,
        session,
        allMeta,
        jellyfishBox: box
      });
      return h.image(buffer, 'image/png');
    });

  ctx.command('水母箱.图鉴', '查看全部水母图鉴')
    .alias('水母图鉴')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';

      const allMeta = await ctx.database.get('mzk_jellyfish_meta', {});
      if (allMeta.length === 0) {
        return '水母图鉴数据尚未加载完成，请稍后再试';
      }

      const buffer = await renderJellyfishStatistics({
        ctx,
        config,
        session,
        allMeta
      });
      return h.image(buffer, 'image/png');
    });

  ctx.command('水母箱.样式 <style:string>', '切换水母箱绘制样式（normal / pixel）')
    .alias('样式')
    .usage('支持切换 normal（默认）或 pixel（像素）样式')
    .example('水母箱 样式 pixel')
    .example('水母箱 样式 normal')
    .action(async ({ session }, style) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      const uid = resolveSessionUserId(session);
      if (!uid) return '无法获取你的用户信息，请稍后再试';
      if (!style) return '请指定样式：normal（默认）或 pixel（像素）';

      const result = await setJellyfishBoxStyle(ctx, uid, session.platform, style);
      if (!result.ok) return result.reason;
      const label = result.style === 'pixel' ? '像素（pixel）' : '默认（normal）';
      return `已将你的水母箱样式切换为：${label}`;
    });

  ctx.command('水母箱.放生 <args:text>', '放生指定水母或指定稀有度的全部水母')
    .alias('放生')
    .usage('支持按名称/ID 指定数量，或按稀有度加 all 批量放生')
    .example('水母箱 放生 普通水母 10')
    .example('水母箱 放生 海月水母 all')
    .example('水母箱 放生 normal all')
    .action(async ({ session }, args) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      const uid = resolveSessionUserId(session);
      if (!uid) return '无法获取你的用户信息，请稍后再试';

      const params = (args ?? '').trim().split(/\s+/).filter(Boolean);
      const result = await dropJellyfish(ctx, uid, session.platform, params);
      if (!result.ok) return result.reason;

      const summary = result.dropped
        .map((item) => (item.isAll ? `全部${item.name}（×${item.count}）` : `${item.name}×${item.count}`))
        .join('、');
      return `成功放生：${summary}`;
    });

  ctx.command('水母箱.投喂 [flavor:string]', '消耗深海食材，让水月为水母箱烹制料理')
    .alias('投喂', '喂水母')
    .usage(`每日最多投喂 ${MAX_DAILY_FEEDS} 次，食材可通过「今日运势」免费领取；可选口味：暖汤（升温）、冰沙（降温）、秘制（调盐度）`)
    .example('投喂')
    .example('投喂 暖汤')
    .example('投喂 冰沙')
    .action(async ({ session }, flavor) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      const uid = resolveSessionUserId(session);
      if (!uid) return '无法获取你的用户信息，请稍后再试';

      const result = await feedJellyfishBox(ctx, config, uid, session.platform, flavor);
      if (!result.ok) return result.reason;

      const buffer = await renderJellyfishBox({
        ctx,
        config,
        session,
        jellyfishBox: result.box,
        allMeta: result.allMeta,
        newJelly: result.added,
        events: result.events
      });
      return [
        h.image(buffer, 'image/png'),
        `剩余深海食材：${result.remainingIngredients} 份（今日已投喂 ${result.feedsUsedToday}/${MAX_DAILY_FEEDS} 次）`
      ];
    });
}
