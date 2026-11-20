import { Bot, Context, h } from 'koishi';
import { Config } from '../config';
import { MzkGroup } from '../database';
import { BroadcastOptions, BroadcastPlan, BroadcastResult, ChangelogData } from './types';

export const QQ_ERR_RATE_LIMITED = 40034100;
export const QQ_ERR_NOT_IN_GROUP = 40034101;
export const QQ_ERR_NO_PROACTIVE_PERMISSION = 40034105;

const RATE_LIMIT_BACKOFF_MS = 5000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 从单层或嵌套（AggregateError / Cordis HTTP Error）错误中提取 QQ 官方 API 错误码。
 */
export function extractQqErrorCode(err: unknown, depth = 0): number | null {
  if (!err || depth > 5) return null;

  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;

    // AggregateError（@satorijs/core MessageEncoder.send 会把发送错误包装为 AggregateError）
    if (Array.isArray(obj.errors)) {
      for (const inner of obj.errors) {
        const code = extractQqErrorCode(inner, depth + 1);
        if (code !== null) return code;
      }
    }

    // Cordis / Axios HTTP Error: err.response.data.code
    const response = obj.response as Record<string, unknown> | undefined;
    const data = response?.data as Record<string, unknown> | undefined;
    if (typeof data?.code === 'number') {
      return data.code;
    }

    // 直接挂在错误对象上的数字错误码
    if (typeof obj.code === 'number') {
      return obj.code;
    }

    if (obj.cause) {
      const causeCode = extractQqErrorCode(obj.cause, depth + 1);
      if (causeCode !== null) return causeCode;
    }
  }

  const msg = err instanceof Error ? err.message : String(err);
  const matched = msg.match(/\b(4003410[015])\b/);
  if (matched) {
    return Number(matched[1]);
  }

  return null;
}

/**
 * 计算本次更新公告的推送计划与跳过统计。
 */
export async function planBroadcast(
  ctx: Context,
  config: Config,
  changelog: ChangelogData,
  options: BroadcastOptions = {}
): Promise<BroadcastPlan> {
  const query: Partial<MzkGroup> = { active: true };
  if (options.platform) {
    query.platform = options.platform;
  }

  const activeGroups = await ctx.database.get('mzk_group', query);
  const targets: MzkGroup[] = [];
  let skippedAlreadyNotified = 0;
  let skippedMuted = 0;
  let skippedNoPermission = 0;

  for (const group of activeGroups) {
    if (group.muted) {
      skippedMuted += 1;
      continue;
    }
    if (!options.includeRestricted && !group.proactive_allowed) {
      skippedNoPermission += 1;
      continue;
    }
    if (!options.force && group.last_notified_version === changelog.version) {
      skippedAlreadyNotified += 1;
      continue;
    }
    targets.push(group);
  }

  const intervalMs = Math.max(200, config.broadcast_interval_ms || 2000);
  const estimatedSeconds = targets.length <= 1
    ? targets.length
    : Math.ceil(((targets.length - 1) * intervalMs) / 1000) + 1;

  return {
    targets,
    totalActive: activeGroups.length,
    skippedAlreadyNotified,
    skippedMuted,
    skippedNoPermission,
    estimatedSeconds
  };
}

function findBotForGroup(ctx: Context, group: MzkGroup): Bot | undefined {
  return ctx.bots.find((bot) => bot.platform === group.platform && bot.selfId === group.self_id)
    ?? ctx.bots.find((bot) => bot.platform === group.platform);
}

/**
 * 按限速间隔串行向目标群推送 PRTS 更新日志卡片，并自动根据 QQ 错误码更新群状态。
 */
export async function executeBroadcast(
  ctx: Context,
  config: Config,
  changelog: ChangelogData,
  imageBuffer: Buffer,
  targets: MzkGroup[],
  options: BroadcastOptions = {},
  sleepFn: (ms: number) => Promise<void> = sleep
): Promise<BroadcastResult> {
  const logger = ctx.logger('mizuki-bot-announcement');
  const startTime = Date.now();
  const intervalMs = Math.max(200, config.broadcast_interval_ms || 2000);

  const versionTag = changelog.version.startsWith('v') || changelog.version.startsWith('V')
    ? changelog.version
    : `v${changelog.version}`;

  const payload = options.withText
    ? [h.image(imageBuffer, 'image/png'), `【水月终端更新 ${versionTag}】${changelog.title}`]
    : h.image(imageBuffer, 'image/png');

  let sent = 0;
  let noPermission = 0;
  let notInGroup = 0;
  let botOffline = 0;
  let failed = 0;

  for (let i = 0; i < targets.length; i++) {
    const group = targets[i];
    const bot = findBotForGroup(ctx, group);
    if (!bot) {
      botOffline += 1;
      logger.warn(`跳过群 ${group.platform}:${group.channel_id}：未找到在线的对应机器人 (${group.self_id})`);
      continue;
    }

    const sendOnce = async () => {
      await bot.sendMessage(group.channel_id, payload, group.guild_id, {});
    };

    try {
      await sendOnce();
      sent += 1;
      await ctx.database.set('mzk_group', { id: group.id }, {
        proactive_allowed: true,
        last_notified_version: changelog.version
      });
    } catch (err) {
      let currentErr: unknown = err;
      let code = extractQqErrorCode(currentErr);
      let retrySucceeded = false;

      // 40034100 限流：退避等待后重试一次
      if (code === QQ_ERR_RATE_LIMITED) {
        logger.warn(`群 ${group.platform}:${group.channel_id} 触发限流 (40034100)，等待 ${RATE_LIMIT_BACKOFF_MS}ms 后重试`);
        await sleepFn(RATE_LIMIT_BACKOFF_MS);
        try {
          await sendOnce();
          sent += 1;
          retrySucceeded = true;
          await ctx.database.set('mzk_group', { id: group.id }, {
            proactive_allowed: true,
            last_notified_version: changelog.version
          });
        } catch (retryErr) {
          currentErr = retryErr;
          code = extractQqErrorCode(retryErr);
        }
      }

      if (!retrySucceeded) {
        if (code === QQ_ERR_NO_PROACTIVE_PERMISSION) {
          noPermission += 1;
          await ctx.database.set('mzk_group', { id: group.id }, { proactive_allowed: false });
          logger.info(`群 ${group.platform}:${group.channel_id} 未开启主动推送权限 (40034105)，已标记跳过`);
        } else if (code === QQ_ERR_NOT_IN_GROUP) {
          notInGroup += 1;
          await ctx.database.set('mzk_group', { id: group.id }, { active: false });
          logger.info(`机器人已不在群 ${group.platform}:${group.channel_id} (40034101)，已标记停用`);
        } else {
          failed += 1;
          logger.warn(
            `向群 ${group.platform}:${group.channel_id} 推送更新日志失败`,
            currentErr instanceof Error ? currentErr.message : String(currentErr)
          );
        }
      }
    }

    if (i < targets.length - 1) {
      await sleepFn(intervalMs);
    }
  }

  return {
    version: changelog.version,
    totalTargets: targets.length,
    sent,
    noPermission,
    notInGroup,
    botOffline,
    failed,
    elapsedMs: Date.now() - startTime
  };
}
