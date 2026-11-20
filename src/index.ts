import * as fs from 'fs';
import * as path from 'path';
import { Context } from 'koishi';
// 仅引入类型：为 ctx.cron 提供声明合并（实际 cron 服务由宿主注入）
import type {} from 'koishi-plugin-cron-fix';
import type {} from '@ltxhhz/koishi-plugin-skia-canvas';
import { registerAnnouncementCommands } from './announcement';
import { registerArknightsCommands } from './arknights';
import { Config } from './config';
import * as Database from './database';
import { registerJellyfishCommands } from './jellyfish';
import {
  arknightsDataCheck,
  arknightsDataUpdate,
  jellyfishBoxCheck,
  jellyfishBoxUpdate
} from './resources/updater';
import { registerUserCommands } from './utils/user';

export const name = 'mizuki-bot';

export const inject = {
  required: ['database', 'cron', 'skia', 'http']
};

export { Config } from './config';
export type { ThemeConfig } from './config';
export type {
  BroadcastOptions,
  BroadcastPlan,
  BroadcastResult,
  ChangelogData,
  ChangelogSection,
  GroupStatusSummary
} from './announcement/types';
export type {
  Decoration,
  DrawStyle,
  EventMeta,
  Jellyfish,
  JellyfishBox,
  JellyfishMeta,
  MzkDailyState,
  MzkGroup,
  MzkUser,
  RarityGroup
} from './database';

declare module 'koishi' {
  interface Events {
    'mizuki/resource_update'(version: string): void;
    'mizuki/arknights_update'(version: string): void;
  }
}

export function apply(ctx: Context, config: Config) {
  const logger = ctx.logger('mizuki-bot');
  const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');
  fs.mkdirSync(root, { recursive: true });

  const reportError = (label: string) => (err: unknown) => {
    logger.error(`${label}失败`, err instanceof Error ? err.message : String(err));
  };

  const checkAllResources = () => {
    jellyfishBoxCheck(ctx, config, root).catch(reportError('检查水母箱资源'));
    arknightsDataCheck(ctx, config, root).catch(reportError('检查明日方舟资源'));
  };

  // 数据库模型
  ctx.plugin(Database);

  // 资源更新事件与定时检查
  ctx.on('ready', checkAllResources);

  ctx.on('mizuki/resource_update', (version: string) => {
    jellyfishBoxUpdate(ctx, config, root, version).catch(reportError('更新水母箱资源'));
  });

  ctx.on('mizuki/arknights_update', (version: string) => {
    arknightsDataUpdate(ctx, config, root, version).catch(reportError('更新明日方舟数据'));
  });

  ctx.cron('5 */2 * * *', checkAllResources);

  // 注册各功能指令
  registerUserCommands(ctx);
  registerJellyfishCommands(ctx, config);
  registerArknightsCommands(ctx, config);
  registerAnnouncementCommands(ctx, config);
}
