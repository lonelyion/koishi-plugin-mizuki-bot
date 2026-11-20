export type RandomFn = () => number;

/**
 * 返回 [min, max] 范围内的随机整数（包含两端）。
 */
export function randomInt(min: number, max: number, rng: RandomFn = Math.random): number {
  const low = Math.ceil(Math.min(min, max));
  const high = Math.floor(Math.max(min, max));
  return Math.floor(rng() * (high - low + 1)) + low;
}

/**
 * 从非空数组中均匀随机选择一个元素。
 */
export function randomChoice<T>(choices: readonly T[], rng: RandomFn = Math.random): T {
  if (choices.length === 0) {
    throw new Error('choices array must not be empty');
  }
  const index = Math.min(choices.length - 1, Math.floor(rng() * choices.length));
  return choices[index];
}

/**
 * 按权重随机选择一个元素。
 * 相比旧实现修复了浮点精度导致 findIndex 返回 -1 以及全 0 权重返回 undefined 的边界问题。
 */
export function randomChoiceWeighted<T>(
  weights: readonly number[],
  choices: readonly T[],
  rng: RandomFn = Math.random
): T {
  if (choices.length === 0) {
    throw new Error('choices array must not be empty');
  }
  if (choices.length !== weights.length) {
    throw new Error('weights and choices arrays must have the same length');
  }

  let total = 0;
  let lastPositiveIndex = -1;
  for (let i = 0; i < weights.length; i++) {
    const w = weights[i];
    if (!Number.isFinite(w) || w < 0) {
      throw new Error(`invalid weight at index ${i}: ${w}`);
    }
    if (w > 0) {
      total += w;
      lastPositiveIndex = i;
    }
  }

  if (total <= 0 || lastPositiveIndex === -1) {
    throw new Error('total weight must be greater than 0');
  }

  const threshold = rng() * total;
  let cumulative = 0;
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i];
    if (weights[i] > 0 && threshold < cumulative) {
      return choices[i];
    }
  }

  return choices[lastPositiveIndex];
}
