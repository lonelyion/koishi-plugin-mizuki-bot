import { DrawStyle, RarityGroup } from '../database';

export const CATCH_COOLDOWN_MS = 2 * 60 * 60 * 1000;
export const REFRESH_INTERVAL_MS = 60 * 60 * 1000;
export const MAX_JELLYFISH_COUNT = 256;
export const TEST_ACCOUNT_REFRESH_HOURS = 10;

export const RARITY_GROUPS: readonly RarityGroup[] = [
  'perfect',
  'great',
  'good',
  'normal',
  'special'
] as const;

export const RARITY_GROUP_SET = new Set<string>(RARITY_GROUPS);

export const NORMAL_CATCH_WEIGHTS: Record<RarityGroup, number> = {
  perfect: 0.02,
  great: 0.08,
  good: 0.50,
  normal: 0.40,
  special: 0.00
};

// 4 月 22 日（世界地球日 / 水月纪念日）特殊概率
export const SPECIAL_DATE_CATCH_WEIGHTS: Record<RarityGroup, number> = {
  perfect: 0.02,
  great: 0.08,
  good: 0.45,
  normal: 0.25,
  special: 0.20
};

export const GROUP_PRIORITY: Record<RarityGroup, number> = {
  perfect: 5,
  great: 4,
  good: 3,
  normal: 2,
  special: 1
};

export const GROUP_REDUCE_WEIGHT: Record<RarityGroup, number> = {
  normal: 16,
  good: 8,
  great: 4,
  perfect: 2,
  special: 1
};

export const SINGLE_DISPLAY_EVENT_IDS = new Set(['happy', 'eat']);

export const ALL_QUANTITY_KEYWORDS = new Set(['all', '全部', '所有']);

export const STYLE_ALIASES: Record<string, DrawStyle> = {
  normal: 'normal',
  default: 'normal',
  默认: 'normal',
  普通: 'normal',
  pixel: 'pixel',
  像素: 'pixel'
};

export function getGroupPriority(group?: string): number {
  return GROUP_PRIORITY[group as RarityGroup] ?? 0;
}

export function getGroupReduceWeight(group?: string): number {
  return GROUP_REDUCE_WEIGHT[group as RarityGroup] ?? 1;
}

export function getCatchWeightsForDate(now: Date): Record<RarityGroup, number> {
  if (now.getMonth() === 3 && now.getDate() === 22) {
    return SPECIAL_DATE_CATCH_WEIGHTS;
  }
  return NORMAL_CATCH_WEIGHTS;
}
