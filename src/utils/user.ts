import { Context, Session } from 'koishi';
import { MzkUser } from '../database';

export const MAX_NICKNAME_LENGTH = 24;
const DEFAULT_FALLBACK_NAME = '水母饲养员';
const QQ_OPENID_PATTERN = /^[0-9A-Fa-f]{32}$/;

interface QQRawPayload {
  d?: {
    author?: {
      username?: string;
      member_nickname?: string;
    };
  };
}

export function resolveSessionUserId(session: Session): string | undefined {
  return session.event.user?.id || session.userId || undefined;
}

/**
 * 从当前平台会话中自动提取用户昵称。
 * 兼容 QQ 官方机器人 API v2：
 * - @satorijs/adapter-qq >= 4.14 已将 GROUP_AT_MESSAGE_CREATE / GROUP_MESSAGE_CREATE / C2C_MESSAGE_CREATE
 *   中的 author.username 映射到 session.event.user.name；
 * - 若 QQ 群聊原始事件附带 member_nickname（群名片），也会优先读取作为群内展示昵称。
 */
export function extractPlatformNickname(session: Session): string | undefined {
  const qqRaw = (session as Session & { qq?: QQRawPayload }).qq;
  const rawAuthor = qqRaw?.d?.author;

  const candidates = [
    session.event.member?.nick,
    rawAuthor?.member_nickname,
    session.event.user?.name,
    rawAuthor?.username,
    session.username
  ];

  for (const candidate of candidates) {
    const trimmed = candidate?.trim();
    if (!trimmed) continue;
    // 避免把 32 位十六进制 QQ OpenID 当成昵称显示
    if (trimmed === session.userId && QQ_OPENID_PATTERN.test(trimmed)) continue;
    return trimmed;
  }

  return undefined;
}

/**
 * 解析最终展示的用户名：
 * 1. 用户通过「叫我」显式设置的自定义昵称
 * 2. 平台自动上报的群名片 / 用户昵称（QQ 官方机器人现已支持）
 * 3. 可读的 userId 或默认称呼
 */
export function resolveDisplayName(user: Pick<MzkUser, 'nickname'> | undefined, session: Session): string {
  const custom = user?.nickname?.trim();
  if (custom) return custom;

  const platformName = extractPlatformNickname(session);
  if (platformName) return platformName;

  const uid = resolveSessionUserId(session);
  if (uid && !QQ_OPENID_PATTERN.test(uid)) {
    return uid;
  }

  return DEFAULT_FALLBACK_NAME;
}

export async function getOrCreateUser(ctx: Context, userId: string, platform: string): Promise<MzkUser> {
  const existing = await ctx.database.get('mzk_user', {
    platform,
    user_id: userId
  });
  if (existing.length > 0) {
    return existing[0];
  }

  try {
    return await ctx.database.create('mzk_user', {
      platform,
      user_id: userId,
      nickname: ''
    });
  } catch (error) {
    // 并发创建命中唯一约束时回查
    const retry = await ctx.database.get('mzk_user', {
      platform,
      user_id: userId
    });
    if (retry.length > 0) {
      return retry[0];
    }
    throw error;
  }
}

export function registerUserCommands(ctx: Context) {
  ctx.command('叫我 [name:text]', '设置或重置你在机器人中的自定义称呼')
    .option('reset', '-r 清除自定义昵称，恢复自动同步平台昵称')
    .usage('平台已支持自动获取昵称；如需自定义显示名称，可使用「叫我 <昵称>」，使用「叫我 -r」可恢复自动同步')
    .example('叫我 海月离')
    .example('叫我 -r')
    .action(async ({ session, options }, rawName) => {
      if (!session) return '无法获取会话信息，请稍后再试';

      const uid = resolveSessionUserId(session);
      if (!uid) return '无法获取你的用户信息，请稍后再试';

      const user = await getOrCreateUser(ctx, uid, session.platform);

      if (options?.reset) {
        await ctx.database.set('mzk_user', user.id, { nickname: '' });
        const fallback = resolveDisplayName({ nickname: '' }, session);
        return `已清除自定义昵称，当前将自动使用平台昵称：${fallback}`;
      }

      const name = (rawName ?? '').trim();
      if (!name) {
        const current = resolveDisplayName(user, session);
        const source = user.nickname?.trim() ? '自定义昵称' : '平台自动获取';
        return `当前称呼：${current}（${source}）\n发送「叫我 <新昵称>」可自定义，发送「叫我 -r」可恢复自动同步`;
      }

      if (name.length > MAX_NICKNAME_LENGTH) {
        return `昵称太长了，请控制在 ${MAX_NICKNAME_LENGTH} 个字符以内`;
      }

      await ctx.database.set('mzk_user', user.id, { nickname: name });
      return `已将你的自定义昵称更新为：${name}`;
    });
}
