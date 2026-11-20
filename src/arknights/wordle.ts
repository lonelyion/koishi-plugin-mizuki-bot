import { RELATED_FACTION_GROUPS } from './constants';
import { OperatorProfile } from './data';
import { randomChoice, randomChoiceWeighted, RandomFn } from '../utils/random';

export type CellMatch = 'exact' | 'close' | 'miss';
export type RarityDirection = 'up' | 'down' | 'none';

export interface WordleGuessComparison {
  operator: OperatorProfile;
  isCorrect: boolean;
  rarity: { match: CellMatch; direction: RarityDirection; text: string };
  profession: { match: CellMatch; text: string };
  subProfession: { match: CellMatch; text: string };
  faction: { match: CellMatch; text: string };
}

export type WordleStatus = 'playing' | 'won' | 'lost' | 'surrendered';

export interface WordleGame {
  channelKey: string;
  target: OperatorProfile;
  guesses: WordleGuessComparison[];
  maxGuesses: number;
  status: WordleStatus;
  hintUsed: boolean;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_MAX_GUESSES = 8;
export const WORDLE_IDLE_TIMEOUT_MS = 5 * 60 * 1000;

function normalizeName(input: string): string {
  return input.trim().toLowerCase().replace(/[\s·・\-_'’]/g, '');
}

function areFactionsRelated(a: OperatorProfile, b: OperatorProfile): boolean {
  const aSet = new Set(a.allFactionIds);
  for (const id of b.allFactionIds) {
    if (aSet.has(id)) return true;
  }

  for (const group of RELATED_FACTION_GROUPS) {
    const groupSet = new Set(group);
    const aHit = a.allFactionIds.some((id) => groupSet.has(id));
    const bHit = b.allFactionIds.some((id) => groupSet.has(id));
    if (aHit && bHit) return true;
  }
  return false;
}

export function compareOperatorGuess(
  guess: OperatorProfile,
  target: OperatorProfile
): WordleGuessComparison {
  const isCorrect = guess.id === target.id;

  // 1. 星级
  const rarityDiff = target.rarity - guess.rarity;
  const rarityDirection: RarityDirection = rarityDiff > 0 ? 'up' : rarityDiff < 0 ? 'down' : 'none';
  const rarityMatch: CellMatch = rarityDiff === 0
    ? 'exact'
    : Math.abs(rarityDiff) === 1
      ? 'close'
      : 'miss';
  const arrow = rarityDirection === 'up' ? ' ↑' : rarityDirection === 'down' ? ' ↓' : '';

  // 2. 职业与分支
  const profMatch: CellMatch = guess.profession === target.profession ? 'exact' : 'miss';
  const subProfMatch: CellMatch = guess.subProfessionId === target.subProfessionId
    ? 'exact'
    : guess.profession === target.profession
      ? 'close'
      : 'miss';

  // 3. 阵营
  const factionMatch: CellMatch = guess.factionId === target.factionId
    ? 'exact'
    : areFactionsRelated(guess, target)
      ? 'close'
      : 'miss';

  return {
    operator: guess,
    isCorrect,
    rarity: { match: rarityMatch, direction: rarityDirection, text: `${guess.rarity}★${arrow}` },
    profession: { match: profMatch, text: guess.professionName },
    subProfession: { match: subProfMatch, text: guess.subProfessionName },
    faction: { match: factionMatch, text: guess.factionName }
  };
}

export function findOperatorByQuery(
  operators: readonly OperatorProfile[],
  query: string
): OperatorProfile | undefined {
  const trimmed = query.trim();
  if (!trimmed) return undefined;

  const exact = operators.find((op) => op.name === trimmed);
  if (exact) return exact;

  const normalized = normalizeName(trimmed);
  if (!normalized) return undefined;

  return operators.find(
    (op) => normalizeName(op.name) === normalized || (op.appellation && normalizeName(op.appellation) === normalized)
  );
}

export function formatOperatorSummary(op: OperatorProfile): string {
  return `${op.name}（${op.rarity}★ ${op.professionName}·${op.subProfessionName} | ${op.factionName}）`;
}

export function buildWordleHint(target: OperatorProfile): string {
  const parts: string[] = [];
  if (target.appellation) {
    parts.push(`英文代号以「${target.appellation[0].toUpperCase()}」开头`);
  }
  parts.push(`中文名共 ${target.name.length} 个字`);
  if (target.tags.length > 0) {
    parts.push(`包含标签「${target.tags[0]}」`);
  }
  return `提示：${parts.join('，')}`;
}

export type WordleDifficulty = 'normal' | 'six' | 'hard';

// 按星级分档加权抽题：降低 5 星（数量最多且普遍较冷门）的命中占比，提高 6 星与经典 4 星的出场率
const NORMAL_RARITY_WEIGHTS: Record<number, number> = {
  6: 0.65,
  5: 0.15,
  4: 0.20
};

const HARD_RARITY_WEIGHTS: Record<number, number> = {
  6: 0.40,
  5: 0.15,
  4: 0.20,
  3: 0.15,
  2: 0.05,
  1: 0.05
};

export function pickWordleTarget(
  operators: readonly OperatorProfile[],
  difficulty: WordleDifficulty = 'normal',
  rng: RandomFn = Math.random
): OperatorProfile {
  if (difficulty === 'six') {
    const sixPool = operators.filter((op) => op.rarity === 6);
    return randomChoice(sixPool.length > 0 ? sixPool : operators, rng);
  }

  const weightsMap = difficulty === 'hard' ? HARD_RARITY_WEIGHTS : NORMAL_RARITY_WEIGHTS;
  const byRarity = new Map<number, OperatorProfile[]>();
  for (const op of operators) {
    if (!(op.rarity in weightsMap)) continue;
    const list = byRarity.get(op.rarity);
    if (list) list.push(op);
    else byRarity.set(op.rarity, [op]);
  }

  const availableRarities = Array.from(byRarity.keys()).sort((a, b) => b - a);
  if (availableRarities.length === 0) {
    return randomChoice(operators, rng);
  }

  const chosenRarity = randomChoiceWeighted(
    availableRarities.map((r) => weightsMap[r]),
    availableRarities,
    rng
  );
  return randomChoice(byRarity.get(chosenRarity)!, rng);
}

export class WordleGameManager {
  private readonly games = new Map<string, WordleGame>();

  getActive(channelKey: string, now = Date.now()): WordleGame | undefined {
    const game = this.games.get(channelKey);
    if (!game) return undefined;
    if (now - game.updatedAt > WORDLE_IDLE_TIMEOUT_MS) {
      this.games.delete(channelKey);
      return undefined;
    }
    return game;
  }

  start(
    channelKey: string,
    operators: readonly OperatorProfile[],
    difficulty: WordleDifficulty = 'normal',
    rng: RandomFn = Math.random,
    now = Date.now()
  ): WordleGame {
    const target = pickWordleTarget(operators, difficulty, rng);
    const game: WordleGame = {
      channelKey,
      target,
      guesses: [],
      maxGuesses: DEFAULT_MAX_GUESSES,
      status: 'playing',
      hintUsed: false,
      createdAt: now,
      updatedAt: now
    };
    this.games.set(channelKey, game);
    return game;
  }

  submitGuess(
    channelKey: string,
    operator: OperatorProfile,
    now = Date.now()
  ): { ok: false; reason: string } | { ok: true; game: WordleGame; comparison: WordleGuessComparison } {
    const game = this.getActive(channelKey, now);
    if (!game) {
      return { ok: false, reason: '当前频道没有正在进行的干员猜谜，发送「猜干员」开启新一局吧！' };
    }

    if (game.guesses.some((g) => g.operator.id === operator.id)) {
      return { ok: false, reason: `本局已经猜过「${operator.name}」啦，换位干员试试吧~` };
    }

    const comparison = compareOperatorGuess(operator, game.target);
    game.guesses.push(comparison);
    game.updatedAt = now;

    if (comparison.isCorrect) {
      game.status = 'won';
      this.games.delete(channelKey);
    } else if (game.guesses.length >= game.maxGuesses) {
      game.status = 'lost';
      this.games.delete(channelKey);
    }

    return { ok: true, game, comparison };
  }

  surrender(channelKey: string, now = Date.now()): WordleGame | undefined {
    const game = this.getActive(channelKey, now);
    if (!game) return undefined;
    game.status = 'surrendered';
    game.updatedAt = now;
    this.games.delete(channelKey);
    return game;
  }

  clearAll() {
    this.games.clear();
  }
}
