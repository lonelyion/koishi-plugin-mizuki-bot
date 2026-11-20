import { Context, h, Session } from 'koishi';
import { Config } from '../config';
import { resolveSessionUserId } from '../utils/user';
import { ensureChangelogFile, loadChangelog } from './changelog';
import { getGroupStatusSummary, registerGroupTracker, toggleGroupMuted } from './groups';
import { renderChangelogCard } from './renderer';
import { executeBroadcast, planBroadcast } from './service';
import { BroadcastOptions, BroadcastPlan, BroadcastResult, ChangelogData } from './types';

const CONFIRM_TIMEOUT_MS = 60 * 1000;

interface PendingBroadcast {
  changelog: ChangelogData;
  filePath: string;
  image: Buffer;
  plan: BroadcastPlan;
  options: BroadcastOptions;
  expiresAt: number;
}

export function isAnnouncementAdmin(session: Session, config: Config): boolean {
  const uid = resolveSessionUserId(session);
  const rawUid = session.userId?.trim();

  const adminList = Array.isArray(config.admin_users) ? config.admin_users : [];
  if (uid && adminList.includes(uid)) return true;
  if (rawUid && adminList.includes(rawUid)) return true;

  const testAccount = config.test_account?.trim();
  if (testAccount && (uid === testAccount || rawUid === testAccount)) return true;

  const authority = (session.user as { authority?: number } | undefined)?.authority;
  if (typeof authority === 'number' && authority >= 3) return true;

  return false;
}

function getAdminKey(session: Session): string {
  const uid = resolveSessionUserId(session) || session.userId || 'unknown';
  return `${session.platform}:${uid}`;
}

function formatDeniedMessage(session: Session): string {
  const uid = resolveSessionUserId(session) || session.userId || '未知';
  return `仅管理员可执行该操作。如需授权，请将你的 userId（${uid}）添加到插件配置的 admin_users 列表中。`;
}

function formatPlanSummary(changelog: ChangelogData, filePath: string, plan: BroadcastPlan): string {
  const versionTag = changelog.version.startsWith('v') || changelog.version.startsWith('V')
    ? changelog.version
    : `v${changelog.version}`;
  const lines = [
    `【更新公告预览】${versionTag} · ${changelog.title}`,
    `日志文件：${filePath}`,
    `活跃群总数：${plan.totalActive} 个｜本次待推送：${plan.targets.length} 个`,
    `跳过统计：已推过同版本 ${plan.skippedAlreadyNotified}｜已免打扰 ${plan.skippedMuted}｜无主动权限 ${plan.skippedNoPermission}`
  ];
  if (plan.targets.length > 0) {
    lines.push(`预计推送耗时：约 ${plan.estimatedSeconds} 秒`);
  }
  return lines.join('\n');
}

function formatBroadcastReport(result: BroadcastResult): string {
  const versionTag = result.version.startsWith('v') || result.version.startsWith('V')
    ? result.version
    : `v${result.version}`;
  const elapsedSec = (result.elapsedMs / 1000).toFixed(1);
  return [
    `【更新公告推送完成】${versionTag}（耗时 ${elapsedSec}s）`,
    `目标群数：${result.totalTargets}`,
    `- 发送成功：${result.sent}`,
    `- 无主动推送权限（40034105，已标记跳过）：${result.noPermission}`,
    `- 已不在群内（40034101，已标记停用）：${result.notInGroup}`,
    `- 对应机器人离线：${result.botOffline}`,
    `- 其他发送失败：${result.failed}`
  ].join('\n');
}

export function registerAnnouncementCommands(ctx: Context, config: Config) {
  const logger = ctx.logger('mizuki-bot-announcement');
  const pendingMap = new Map<string, PendingBroadcast>();
  let isBroadcasting = false;

  ctx.on('dispose', () => {
    pendingMap.clear();
  });

  // 自动记录进群/退群与活跃群
  registerGroupTracker(ctx);

  // 启动时确保默认 changelog.json 模板存在，方便随时修改
  ctx.on('ready', () => {
    ensureChangelogFile(ctx, config).catch((err) => {
      logger.warn('初始化默认更新日志文件失败', err instanceof Error ? err.message : String(err));
    });
  });

  // 1. 查看最新更新公告卡片（全员可用）
  ctx.command('更新公告', '查看当前版本的水月终端 PRTS 更新日志卡片')
    .alias('水母公告', '更新日志', 'changelog')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      try {
        const { data } = await loadChangelog(ctx, config);
        const image = await renderChangelogCard(ctx, config, data);
        return h.image(image, 'image/png');
      } catch (err) {
        return `加载更新日志失败：${err instanceof Error ? err.message : String(err)}`;
      }
    });

  // 2. 管理员预览：渲染卡片 + 展示待推送群统计（不发送）
  ctx.command('更新公告.预览', '管理员预览更新日志卡片及本次待推送群统计')
    .option('force', '-f 包含已推送过当前版本的群')
    .option('all', '-a 包含曾返回无主动推送权限的群')
    .option('platform', '-p <platform:string> 仅统计指定平台')
    .action(async ({ session, options }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      if (!isAnnouncementAdmin(session, config)) {
        return formatDeniedMessage(session);
      }

      try {
        const { data, filePath } = await loadChangelog(ctx, config);
        const plan = await planBroadcast(ctx, config, data, {
          force: Boolean(options?.force),
          includeRestricted: Boolean(options?.all),
          platform: options?.platform
        });
        const image = await renderChangelogCard(ctx, config, data);
        return [h.image(image, 'image/png'), formatPlanSummary(data, filePath, plan)];
      } catch (err) {
        return `预览更新公告失败：${err instanceof Error ? err.message : String(err)}`;
      }
    });

  // 3. 管理员发起推送（生成预览并挂起 60 秒待确认，兼容 QQ 官方群 @机器人 交互）
  ctx.command('更新公告.推送', '管理员准备向所有活跃群推送 PRTS 更新日志卡片（需二次确认）')
    .option('force', '-f 强制重推给已收到当前版本的群')
    .option('all', '-a 重试之前返回无主动推送权限的群')
    .option('text', '-t 在卡片图片外附带简短纯文本标题')
    .option('platform', '-p <platform:string> 仅推送给指定平台')
    .action(async ({ session, options }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      if (!isAnnouncementAdmin(session, config)) {
        return formatDeniedMessage(session);
      }
      if (isBroadcasting) {
        return '当前已有更新公告正在推送中，请等待本次推送完成后再试。';
      }

      let data: ChangelogData;
      let filePath: string;
      try {
        const loaded = await loadChangelog(ctx, config);
        data = loaded.data;
        filePath = loaded.filePath;
      } catch (err) {
        return `加载更新日志失败，已中止推送：${err instanceof Error ? err.message : String(err)}`;
      }

      const broadcastOptions: BroadcastOptions = {
        force: Boolean(options?.force),
        includeRestricted: Boolean(options?.all),
        withText: Boolean(options?.text),
        platform: options?.platform
      };

      const plan = await planBroadcast(ctx, config, data, broadcastOptions);
      const image = await renderChangelogCard(ctx, config, data);

      if (plan.targets.length === 0) {
        return [
          h.image(image, 'image/png'),
          `${formatPlanSummary(data, filePath, plan)}\n\n当前没有需要推送的目标群（如需重推已通知群可加 -f 参数）。`
        ];
      }

      pendingMap.set(getAdminKey(session), {
        changelog: data,
        filePath,
        image,
        plan,
        options: broadcastOptions,
        expiresAt: Date.now() + CONFIRM_TIMEOUT_MS
      });

      return [
        h.image(image, 'image/png'),
        `${formatPlanSummary(data, filePath, plan)}\n\n请在 60 秒内发送「更新公告.确认」开始推送，或发送「更新公告.取消」放弃本次推送。`
      ];
    });

  // 3b. 管理员确认推送
  ctx.command('更新公告.确认', '确认执行待发送的更新公告群发任务')
    .alias('确认推送')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      if (!isAnnouncementAdmin(session, config)) {
        return formatDeniedMessage(session);
      }

      const key = getAdminKey(session);
      const pending = pendingMap.get(key);
      if (!pending) {
        return '当前没有待确认的更新公告推送任务，请先发送「更新公告.推送」。';
      }
      pendingMap.delete(key);

      if (Date.now() > pending.expiresAt) {
        return '本次推送确认已超时（超过 60 秒），请重新发送「更新公告.推送」。';
      }

      if (isBroadcasting) {
        return '当前已有更新公告正在推送中，请等待本次推送完成后再试。';
      }

      isBroadcasting = true;
      try {
        await session.send(`收到确认，正在向 ${pending.plan.targets.length} 个群限速推送更新日志，请稍候...`);
        const result = await executeBroadcast(
          ctx,
          config,
          pending.changelog,
          pending.image,
          pending.plan.targets,
          pending.options
        );
        return formatBroadcastReport(result);
      } finally {
        isBroadcasting = false;
      }
    });

  // 3c. 管理员取消推送
  ctx.command('更新公告.取消', '取消待确认的更新公告推送任务')
    .alias('取消推送')
    .action(({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      if (!isAnnouncementAdmin(session, config)) {
        return formatDeniedMessage(session);
      }
      const deleted = pendingMap.delete(getAdminKey(session));
      return deleted ? '已取消待执行的更新公告推送。' : '当前没有待确认的更新公告推送任务。';
    });

  // 4. 管理员查看群收录与推送状态
  ctx.command('更新公告.状态', '查看已记录的群组状态与更新日志配置')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      if (!isAnnouncementAdmin(session, config)) {
        return formatDeniedMessage(session);
      }

      let version = '';
      let filePath = '';
      let loadErr = '';
      try {
        const loaded = await loadChangelog(ctx, config);
        version = loaded.data.version;
        filePath = loaded.filePath;
      } catch (err) {
        loadErr = err instanceof Error ? err.message : String(err);
      }

      const summary = await getGroupStatusSummary(ctx, version);
      const lines = [
        '【更新公告系统状态】',
        loadErr ? `日志文件异常：${loadErr}` : `当前版本：v${version.replace(/^v/i, '')}（${filePath}）`,
        `已记录群总数：${summary.total}（活跃 ${summary.active} / 已退群 ${summary.inactive}）`,
        `活跃群中：已收当前版本 ${summary.notifiedCurrent}｜已免打扰 ${summary.muted}｜无主动权限 ${summary.noPermission}`,
        `推送间隔：${config.broadcast_interval_ms}ms｜当前在线 Bot：${ctx.bots.length} 个`
      ];
      return lines.join('\n');
    });

  // 5. 群内开关（支持单个群退订/重新订阅更新公告）
  ctx.command('更新公告.开关', '开启或关闭本群接收水月终端更新公告推送')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      if (session.isDirect || (!session.channelId && !session.guildId)) {
        return '请在群聊中使用该指令以切换本群的更新公告接收状态。';
      }

      const channelId = session.channelId || session.guildId!;
      const guildId = session.guildId || session.channelId!;
      const muted = await toggleGroupMuted(ctx, {
        platform: session.platform,
        selfId: session.selfId,
        guildId,
        channelId
      });

      return muted
        ? '已关闭本群的更新日志主动推送（仍可随时发送「更新公告」手动查看）。'
        : '已重新开启本群的更新日志主动推送！';
    });
}
