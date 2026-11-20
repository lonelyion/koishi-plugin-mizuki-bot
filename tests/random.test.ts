import { describe, expect, it } from 'vitest';
import { randomChoice, randomChoiceWeighted, randomInt } from '../src/utils/random';

describe('random utils', () => {
  it('randomInt returns values within [min, max]', () => {
    expect(randomInt(4, 6, () => 0)).toBe(4);
    expect(randomInt(4, 6, () => 0.999999)).toBe(6);
    expect(randomInt(5, 5, () => 0.5)).toBe(5);
  });

  it('randomChoice throws on empty array and picks valid elements', () => {
    expect(() => randomChoice([])).toThrow();
    expect(randomChoice(['a', 'b', 'c'], () => 0)).toBe('a');
    expect(randomChoice(['a', 'b', 'c'], () => 0.999999)).toBe('c');
  });

  it('randomChoiceWeighted handles floating point precision and zero weights safely', () => {
    const choices = ['a', 'b', 'c'];
    const weights = [0.1, 0.2, 0.3];
    // 即使 rng 返回 0.9999999999999999 或 1 也不会越界返回 undefined
    expect(randomChoiceWeighted(weights, choices, () => 0.9999999999999999)).toBe('c');
    expect(randomChoiceWeighted(weights, choices, () => 1)).toBe('c');
    expect(randomChoiceWeighted([0, 0.5, 0], choices, () => 0.5)).toBe('b');
    expect(randomChoiceWeighted([0.2, 0.8, 0], choices, () => 0.999999)).toBe('b');
  });

  it('randomChoiceWeighted rejects invalid weights', () => {
    expect(() => randomChoiceWeighted([0, 0], ['a', 'b'])).toThrow();
    expect(() => randomChoiceWeighted([-1, 2], ['a', 'b'])).toThrow();
    expect(() => randomChoiceWeighted([1], ['a', 'b'])).toThrow();
  });
});
