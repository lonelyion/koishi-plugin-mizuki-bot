import { Context, Session } from 'koishi';
import { MzkGroup } from '../database';
import { GroupStatusSummary } from './types';

const ACTIVITY_TOUCH_COOLDOWN_MS = 10 * 60 * 1000;

function extractGroupIdentity(session: Session): {
  platform: string;
  selfId: string;
  guildId: string;
  channelId: string;
} | null {
  if (session.isDirect) return null;
  const platform = session.platform;
  const selfId = session.selfId;
  const channelId = session.channelId || session.guildId;
  const guildId = session.guildId || session.channelId;
  if (!platform || !selfId || !channelId || !guildId) return null;
  return { platform, selfId, guildId, channelId };
}

/**
 * 记录或激活一个群组（不会覆盖已有的 muted / proactive_allowed / last_notified_version）。
 */
export async function recordGroupActivity(
  ctx: Context,
  identity: { platform: string; selfId: string; guildId: string; channelId: string },
  resetProactive = false
): Promise<MzkGroup> {
  const now = new Date();
  const [existing] = await ctx.database.get('mzk_group', {
    platform: identity.platform,
    self_id: identity.selfId,
    channel_id: identity.channelId
  });

  if (!existing) {
    return ctx.database.create('mzk_group', {
      platform: identity.platform,
      self_id: identity.selfId,
      guild_id: identity.guildId,
      channel_id: identity.channelId,
      active: true,
      proactive_allowed: true,
      muted: false,
      last_notified_version: '',
      last_active_at: now
    });
  }

  const patch: Partial<MzkGroup> = {
    guild_id: identity.guildId,
    active: true,
    last_active_at: now
  };
  if (resetProactive) {
    patch.proactive_allowed = true;
  }

  await ctx.database.set('mzk_group', { id: existing.id }, patch);
  return { ...existing, ...patch };
}

export async function markGroupInactive(
  ctx: Context,
  identity: { platform: string; selfId: string; guildId?: string; channelId?: string }
): Promise<void> {
  const query: Partial<MzkGroup> = {
    platform: identity.platform,
    self_id: identity.selfId
  };
  if (identity.channelId) {
    query.channel_id = identity.channelId;
  } else if (identity.guildId) {
    query.guild_id = identity.guildId;
  } else {
    return;
  }

  await ctx.database.set('mzk_group', query, { active: false });
}

export async function toggleGroupMuted(
  ctx: Context,
  identity: { platform: string; selfId: string; guildId: string; channelId: string }
): Promise<boolean> {
  const group = await recordGroupActivity(ctx, identity);
  const nextMuted = !group.muted;
  await ctx.database.set('mzk_group', { id: group.id }, { muted: nextMuted });
  return nextMuted;
}

export async function getGroupStatusSummary(
  ctx: Context,
  currentVersion: string
): Promise<GroupStatusSummary> {
  const groups = await ctx.database.get('mzk_group', {});
  let active = 0;
  let inactive = 0;
  let muted = 0;
  let noPermission = 0;
  let notifiedCurrent = 0;

  for (const g of groups) {
    if (!g.active) {
      inactive += 1;
      continue;
    }
    active += 1;
    if (g.muted) muted += 1;
    if (!g.proactive_allowed) noPermission += 1;
    if (currentVersion && g.last_notified_version === currentVersion) {
      notifiedCurrent += 1;
    }
  }

  return {
    total: groups.length,
    active,
    inactive,
    muted,
    noPermission,
    notifiedCurrent
  };
}

/**
 * 注册群组自动采集监听器：
 * - guild-added：机器人进群时立即建档/重新激活
 * - guild-removed：机器人退群/被踢时标记 inactive
 * - message：群聊互动时节流补录存量老群（每群每 10 分钟最多写库一次）
 */
export function registerGroupTracker(ctx: Context) {
  const logger = ctx.logger('mizuki-bot-announcement');
  const recentTouched = new Map<string, number>();

  ctx.on('guild-added', (session) => {
    const id = extractGroupIdentity(session);
    if (!id) return;
    const key = `${id.platform}:${id.selfId}:${id.channelId}`;
    recentTouched.set(key, Date.now());
    recordGroupActivity(ctx, id, true).catch((err) => {
      logger.warn('记录新加入群失败', err instanceof Error ? err.message : String(err));
    });
  });

  ctx.on('guild-removed', (session) => {
    const platform = session.platform;
    const selfId = session.selfId;
    const guildId = session.guildId;
    const channelId = session.channelId;
    if (!platform || !selfId || (!guildId && !channelId)) return;
    if (channelId) {
      recentTouched.delete(`${platform}:${selfId}:${channelId}`);
    }
    markGroupInactive(ctx, { platform, selfId, guildId, channelId }).catch((err) => {
      logger.warn('标记退出群失败', err instanceof Error ? err.message : String(err));
    });
  });

  ctx.on('message', (session) => {
    const id = extractGroupIdentity(session);
    if (!id) return;
    const key = `${id.platform}:${id.selfId}:${id.channelId}`;
    const now = Date.now();
    const last = recentTouched.get(key) ?? 0;
    if (now - last < ACTIVITY_TOUCH_COOLDOWN_MS) return;

    recentTouched.set(key, now);
    recordGroupActivity(ctx, id).catch((err) => {
      recentTouched.delete(key);
      logger.debug('记录群组活跃信息失败', err instanceof Error ? err.message : String(err));
    });
  });

  ctx.on('dispose', () => {
    recentTouched.clear();
  });
}
