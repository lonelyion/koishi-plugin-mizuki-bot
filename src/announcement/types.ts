import { MzkGroup } from '../database';

export interface ChangelogSection {
  /** 标签，如 NEW / UPDATE / FIX / NOTICE */
  tag: string;
  /** 分组标题，如 新增功能 / 内容扩充 / 问题修复 */
  title: string;
  /** 条目列表 */
  items: string[];
}

export interface ChangelogData {
  /** 版本号，如 1.2.0 */
  version: string;
  /** 发布日期，如 2026-11-20 */
  date: string;
  /** 公告主标题 */
  title: string;
  /** 顶部副标题（可选，默认 PRTS // SYSTEM UPDATE DISPATCH） */
  subtitle?: string;
  /** 顶部简述（可选） */
  summary?: string;
  /** 分类更新条目 */
  sections: ChangelogSection[];
  /** 底部备注（可选） */
  footer?: string;
}

export interface BroadcastOptions {
  /** 是否忽略已推送版本记录，强制重新发送给同版本已推送群 */
  force?: boolean;
  /** 是否重试之前返回 40034105（无主动推送权限）的群 */
  includeRestricted?: boolean;
  /** 是否在图片外附带简短纯文本标题 */
  withText?: boolean;
  /** 仅推送给指定平台（可选） */
  platform?: string;
}

export interface BroadcastPlan {
  targets: MzkGroup[];
  totalActive: number;
  skippedAlreadyNotified: number;
  skippedMuted: number;
  skippedNoPermission: number;
  estimatedSeconds: number;
}

export interface BroadcastResult {
  version: string;
  totalTargets: number;
  sent: number;
  noPermission: number;
  notInGroup: number;
  botOffline: number;
  failed: number;
  elapsedMs: number;
}

export interface GroupStatusSummary {
  total: number;
  active: number;
  inactive: number;
  muted: number;
  noPermission: number;
  notifiedCurrent: number;
}
