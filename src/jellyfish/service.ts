import { Context } from 'koishi';
import { Config } from '../config';
import { DrawStyle, EventMeta, Jellyfish, JellyfishBox, JellyfishMeta } from '../database';
import { KeyedAsyncLock } from '../utils/lock';
import { randomChoice, randomChoiceWeighted, RandomFn, randomInt } from '../utils/random';
import { getOrCreateUser } from '../utils/user';
import {
  ALL_QUANTITY_KEYWORDS,
  CATCH_COOLDOWN_MS,
  getCatchWeightsForDate,
  getGroupReduceWeight,
  MAX_JELLYFISH_COUNT,
  RARITY_GROUP_SET,
  RARITY_GROUPS,
  REFRESH_INTERVAL_MS,
  SINGLE_DISPLAY_EVENT_IDS,
  STYLE_ALIASES,
  TEST_ACCOUNT_REFRESH_HOURS
} from './constants';

export interface JellyfishBoxEvent {
  id: string;
  name: string;
  description: string;
}

export interface ParsedDropToken {
  target: string;
  quantity: number | 'all';
  rawQuantity?: string;
  invalidQuantity?: boolean;
}

export interface ResolvedDropItem {
  id: string;
  name: string;
  count: number;
  isAll: boolean;
}

export interface SimulateEventsResult {
  jellyfish: Jellyfish[];
  events: JellyfishBoxEvent[];
  refreshed: boolean;
}

export type CatchJellyfishResult =
  | { ok: true; box: JellyfishBox; added: Jellyfish; addedMeta: JellyfishMeta; events: JellyfishBoxEvent[] }
  | { ok: false; reason: string };

export type DropJellyfishResult =
  | { ok: true; dropped: ResolvedDropItem[]; box: JellyfishBox }
  | { ok: false; reason: string };

export const boxLock = new KeyedAsyncLock();

export function getJellyfishCount(jellyfish: readonly Jellyfish[]): number {
  return jellyfish.reduce((sum, item) => sum + item.number, 0);
}

/**
 * 计算按小时折算的刷新次数（单调递增、上限 48，避免长时间未登录一次触发过多事件）。
 */
export function computeRefreshHours(elapsedMs: number): number {
  if (elapsedMs < REFRESH_INTERVAL_MS) return 0;
  const rawHours = Math.floor(elapsedMs / REFRESH_INTERVAL_MS);
  if (rawHours <= 24) return rawHours;
  if (rawHours <= 72) return 24 + Math.floor((rawHours - 24) / 4);
  return Math.min(48, 36 + Math.floor((rawHours - 72) / 24));
}

export function computeCatchCount(
  speciesCount: number,
  totalCount: number,
  rng: RandomFn = Math.random
): number {
  if (speciesCount === 0) return randomInt(4, 6, rng);
  if (totalCount < 10) return randomInt(3, 4, rng);
  if (totalCount < 20) return randomInt(2, 3, rng);
  if (totalCount < 50) return randomInt(1, 2, rng);
  return 1;
}

export function formatRemainingCooldown(remainingMs: number): string {
  const totalSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours ? `${hours}小时` : ''}${minutes ? `${minutes}分` : ''}${seconds}秒`;
}

export function resolveDrawStyle(input: string): DrawStyle | undefined {
  return STYLE_ALIASES[input.trim().toLowerCase()];
}

export async function getOrCreateJellyfishBox(
  ctx: Context,
  userId: string,
  platform: string
): Promise<JellyfishBox> {
  const user = await getOrCreateUser(ctx, userId, platform);
  const existing = await ctx.database.get('mzk_jellyfish_box', { user_id: user.id });
  if (existing.length > 0) {
    return existing[0];
  }

  const initialTime = new Date(Date.now() - CATCH_COOLDOWN_MS);
  try {
    return await ctx.database.create('mzk_jellyfish_box', {
      user_id: user.id,
      last_catch_time: initialTime,
      last_refresh_time: initialTime,
      jellyfish: [],
      decoration: [],
      salinity: 25,
      temperature: 25,
      draw_style: 'normal'
    });
  } catch (error) {
    const retry = await ctx.database.get('mzk_jellyfish_box', { user_id: user.id });
    if (retry.length > 0) {
      return retry[0];
    }
    throw error;
  }
}

/**
 * 纯函数版本的水母箱事件与繁殖模拟，方便测试并消除副作用。
 */
export function simulateBoxEventsPure(params: {
  box: JellyfishBox;
  metaMap: Map<string, JellyfishMeta>;
  eventMetas: readonly EventMeta[];
  now: Date;
  isTestAccount: boolean;
  rng?: RandomFn;
}): SimulateEventsResult {
  const { box, metaMap, eventMetas, now, isTestAccount, rng = Math.random } = params;
  const elapsedMs = now.getTime() - new Date(box.last_refresh_time).getTime();
  const refreshHours = isTestAccount
    ? TEST_ACCOUNT_REFRESH_HOURS
    : computeRefreshHours(elapsedMs);

  if (refreshHours <= 0) {
    return {
      jellyfish: box.jellyfish.map((item) => ({ ...item })),
      events: [],
      refreshed: false
    };
  }

  const jellyfish = box.jellyfish.map((item) => ({ ...item }));
  const events: JellyfishBoxEvent[] = [];

  if (jellyfish.length === 0) {
    return { jellyfish, events, refreshed: true };
  }

  // 1. 自然繁殖
  let totalCount = getJellyfishCount(jellyfish);
  for (const item of jellyfish) {
    if (totalCount >= MAX_JELLYFISH_COUNT) break;
    const meta = metaMap.get(item.id);
    if (!meta || meta.reproductive_rate <= 0 || item.number <= 0) continue;

    let rate = (meta.reproductive_rate / 30 / 24) * item.number * refreshHours;
    if (totalCount > 50) {
      rate = rate / totalCount;
    }

    let numToAdd = Math.floor(rate);
    const fractional = rate - numToAdd;
    if (fractional > 0 && rng() < fractional) {
      numToAdd += 1;
    }

    const availableSpace = MAX_JELLYFISH_COUNT - totalCount;
    numToAdd = Math.min(numToAdd, availableSpace);

    if (numToAdd > 0) {
      item.number += numToAdd;
      totalCount += numToAdd;
      events.push({
        id: 'reproductive',
        name: '繁殖',
        description: `在水母箱中繁殖出了${numToAdd}只新的${meta.name}`
      });
    }
  }

  // 2. 随机事件
  const getBreedCandidates = () =>
    jellyfish
      .filter((item) => item.number >= 2)
      .map((item) => ({ item, meta: metaMap.get(item.id) }))
      .filter((c): c is { item: Jellyfish; meta: JellyfishMeta } => Boolean(c.meta));

  const getReduceCandidates = () =>
    jellyfish
      .filter((item) => item.number > 0)
      .map((item) => ({ item, meta: metaMap.get(item.id) }))
      .filter((c): c is { item: Jellyfish; meta: JellyfishMeta } => c.meta !== undefined && !c.meta.protected);

  const getEligibleEvents = () => {
    const canBreed = totalCount < MAX_JELLYFISH_COUNT && getBreedCandidates().length > 0;
    const canReduce = getReduceCandidates().length > 0;
    return eventMetas.filter((event) => {
      if (event.probability <= 0) return false;
      if (event.type === 'breed' && !canBreed) return false;
      if (event.type === 'reduce' && !canReduce) return false;
      return true;
    });
  };

  const initialEligible = getEligibleEvents();
  if (initialEligible.length > 0) {
    const totalProbability = initialEligible.reduce((sum, e) => sum + e.probability, 0) * refreshHours;
    let eventCount = Math.floor(totalProbability);
    const fractional = totalProbability - eventCount;
    if (fractional > 0 && rng() < fractional) {
      eventCount += 1;
    }

    const displayedSingleIds = new Set<string>();

    for (let i = 0; i < eventCount; i++) {
      const eligible = getEligibleEvents();
      if (eligible.length === 0) break;

      const event = randomChoiceWeighted(
        eligible.map((e) => e.probability),
        eligible,
        rng
      );

      if (SINGLE_DISPLAY_EVENT_IDS.has(event.id)) {
        if (displayedSingleIds.has(event.id)) continue;
        displayedSingleIds.add(event.id);
      }

      if (event.type === 'breed') {
        const candidates = getBreedCandidates();
        if (candidates.length === 0 || totalCount >= MAX_JELLYFISH_COUNT) continue;
        const chosen = randomChoice(candidates, rng);
        chosen.item.number += 1;
        totalCount += 1;
        events.push({
          id: event.id,
          name: event.name,
          description: `两只${chosen.meta.name}繁殖出了一只新的${chosen.meta.name}`
        });
        continue;
      }

      if (event.type === 'reduce') {
        const candidates = getReduceCandidates();
        if (candidates.length === 0) continue;
        const chosen = randomChoiceWeighted(
          candidates.map((c) => c.item.number * getGroupReduceWeight(c.meta.group)),
          candidates,
          rng
        );
        chosen.item.number -= 1;
        totalCount -= 1;
        if (chosen.item.number <= 0) {
          const idx = jellyfish.findIndex((item) => item.id === chosen.item.id);
          if (idx !== -1) jellyfish.splice(idx, 1);
        }
        events.push({
          id: event.id,
          name: event.name,
          description: `${chosen.meta.name}遇到旋涡被冲走了`
        });
        continue;
      }

      events.push({
        id: event.id,
        name: event.name,
        description: event.description
      });
    }
  }

  return {
    jellyfish: jellyfish.filter((item) => item.number > 0),
    events,
    refreshed: true
  };
}

/**
 * 查看水母箱：自动结算未刷新的繁殖与随机事件并持久化。
 */
export async function viewJellyfishBox(
  ctx: Context,
  config: Config,
  userId: string,
  platform: string,
  now: Date = new Date()
): Promise<{ box: JellyfishBox; events: JellyfishBoxEvent[]; allMeta: JellyfishMeta[] }> {
  return boxLock.run(`${platform}:${userId}`, async () => {
    const box = await getOrCreateJellyfishBox(ctx, userId, platform);
    const [allMeta, eventMetas] = await Promise.all([
      ctx.database.get('mzk_jellyfish_meta', {}),
      ctx.database.get('mzk_jellyfish_event_meta', {})
    ]);
    const metaMap = new Map(allMeta.map((m) => [m.id, m]));

    const sim = simulateBoxEventsPure({
      box,
      metaMap,
      eventMetas,
      now,
      isTestAccount: userId === config.test_account
    });

    if (sim.refreshed) {
      box.jellyfish = sim.jellyfish;
      box.last_refresh_time = now;
      await ctx.database.set('mzk_jellyfish_box', box.user_id, {
        last_refresh_time: box.last_refresh_time,
        jellyfish: box.jellyfish
      });
    }

    return { box, events: sim.events, allMeta };
  });
}

/**
 * 抓水母：在用户级锁内检查冷却/容量、先结算事件、再按稀有度权重抽取并单次写入数据库。
 */
export async function catchJellyfish(
  ctx: Context,
  config: Config,
  userId: string,
  platform: string,
  now: Date = new Date(),
  rng: RandomFn = Math.random
): Promise<CatchJellyfishResult> {
  return boxLock.run(`${platform}:${userId}`, async () => {
    const box = await getOrCreateJellyfishBox(ctx, userId, platform);
    const isTestAccount = userId === config.test_account;

    const lastCatchMs = new Date(box.last_catch_time).getTime();
    const remainingMs = lastCatchMs + CATCH_COOLDOWN_MS - now.getTime();
    if (!isTestAccount && remainingMs > 0) {
      return {
        ok: false,
        reason: `别抓啦，过${formatRemainingCooldown(remainingMs)}再来吧！`
      };
    }

    const currentCount = getJellyfishCount(box.jellyfish);
    if (currentCount >= MAX_JELLYFISH_COUNT) {
      return {
        ok: false,
        reason: `别抓啦，水母箱里的水母已经达到上限（${MAX_JELLYFISH_COUNT}只）了！可以先放生一些再继续抓~`
      };
    }

    const [allMeta, eventMetas] = await Promise.all([
      ctx.database.get('mzk_jellyfish_meta', {}),
      ctx.database.get('mzk_jellyfish_event_meta', {})
    ]);
    if (allMeta.length === 0) {
      return {
        ok: false,
        reason: '水母图鉴数据尚未加载完成，请稍后再试'
      };
    }

    // 1. 抓水母前先结算箱内事件
    const metaMap = new Map(allMeta.map((m) => [m.id, m]));
    const sim = simulateBoxEventsPure({
      box,
      metaMap,
      eventMetas,
      now,
      isTestAccount,
      rng
    });
    const nextJellyfish = sim.jellyfish;
    const countAfterEvents = getJellyfishCount(nextJellyfish);

    // 2. 计算抓取数量（不超过容量上限）
    const baseCatchNum = computeCatchCount(nextJellyfish.length, countAfterEvents, rng);
    const catchNum = Math.max(1, Math.min(baseCatchNum, Math.max(1, MAX_JELLYFISH_COUNT - countAfterEvents)));

    // 3. 过滤出实际存在水母的稀有度组（避免 4 月 22 日 special 组为空时崩溃）
    const weightsByGroup = getCatchWeightsForDate(now);
    const metaByGroup = new Map<string, JellyfishMeta[]>();
    for (const meta of allMeta) {
      const list = metaByGroup.get(meta.group);
      if (list) list.push(meta);
      else metaByGroup.set(meta.group, [meta]);
    }

    const candidateGroups = RARITY_GROUPS.filter((g) => (metaByGroup.get(g)?.length ?? 0) > 0 && weightsByGroup[g] > 0);
    const selectedGroup = candidateGroups.length > 0
      ? randomChoiceWeighted(candidateGroups.map((g) => weightsByGroup[g]), candidateGroups, rng)
      : undefined;

    const pool = selectedGroup ? metaByGroup.get(selectedGroup)! : allMeta;
    const selectedMeta = randomChoice(pool, rng);

    const existingIndex = nextJellyfish.findIndex((j) => j.id === selectedMeta.id);
    if (existingIndex === -1) {
      nextJellyfish.push({ id: selectedMeta.id, number: catchNum });
    } else {
      nextJellyfish[existingIndex].number += catchNum;
    }

    box.jellyfish = nextJellyfish;
    box.last_catch_time = now;
    if (sim.refreshed) {
      box.last_refresh_time = now;
    }

    await ctx.database.set('mzk_jellyfish_box', box.user_id, {
      last_catch_time: box.last_catch_time,
      last_refresh_time: box.last_refresh_time,
      jellyfish: box.jellyfish
    });

    return {
      ok: true,
      box,
      added: { id: selectedMeta.id, number: catchNum },
      addedMeta: selectedMeta,
      events: sim.events
    };
  });
}

const NUMERIC_TOKEN_PATTERN = /^[+-]?\d+(?:\.\d+)?$/;

export function parseDropArgs(params: readonly string[]): ParsedDropToken[] {
  const result: ParsedDropToken[] = [];
  let i = 0;

  while (i < params.length) {
    const target = params[i]?.trim();
    if (!target) {
      i += 1;
      continue;
    }

    let quantity: number | 'all' = 1;
    let rawQuantity: string | undefined;
    let invalidQuantity = false;

    if (i + 1 < params.length) {
      const next = params[i + 1].trim();
      if (ALL_QUANTITY_KEYWORDS.has(next.toLowerCase())) {
        quantity = 'all';
        rawQuantity = next;
        i += 1;
      } else if (NUMERIC_TOKEN_PATTERN.test(next)) {
        const parsed = Number(next);
        rawQuantity = next;
        if (Number.isInteger(parsed) && parsed > 0) {
          quantity = parsed;
        } else {
          invalidQuantity = true;
        }
        i += 1;
      }
    }

    result.push({ target, quantity, rawQuantity, invalidQuantity });
    i += 1;
  }

  return result;
}

export function resolveDropPlan(
  tokens: readonly ParsedDropToken[],
  box: JellyfishBox,
  allMeta: readonly JellyfishMeta[]
): { errors: string[]; items: ResolvedDropItem[] } {
  const metaById = new Map(allMeta.map((m) => [m.id, m]));
  const metaByName = new Map(allMeta.map((m) => [m.name, m]));
  const boxMap = new Map(box.jellyfish.map((j) => [j.id, j.number]));

  const errors: string[] = [];
  // 按水母 ID 聚合放生计划，防止重复输入（如「普通水母 5 普通水母 5」）导致扣成负数
  const aggregated = new Map<string, { name: string; count: number; isAll: boolean }>();

  const addPlan = (id: string, name: string, qty: number | 'all') => {
    const current = aggregated.get(id);
    if (qty === 'all') {
      const owned = boxMap.get(id) ?? 0;
      aggregated.set(id, { name, count: owned, isAll: true });
      return;
    }
    if (!current) {
      aggregated.set(id, { name, count: qty, isAll: false });
    } else if (!current.isAll) {
      current.count += qty;
    }
  };

  for (const token of tokens) {
    if (token.invalidQuantity) {
      errors.push(`${token.target} 的放生数量「${token.rawQuantity}」无效，请输入正整数或 all`);
      continue;
    }

    const lowerTarget = token.target.toLowerCase();
    if (RARITY_GROUP_SET.has(lowerTarget)) {
      if (token.quantity !== 'all') {
        errors.push(`按稀有度放生 ${lowerTarget} 时，数量必须为 all（例：放生 ${lowerTarget} all）`);
        continue;
      }
      const groupIds = new Set(allMeta.filter((m) => m.group === lowerTarget).map((m) => m.id));
      const matched = box.jellyfish.filter((j) => groupIds.has(j.id) && j.number > 0);
      if (matched.length === 0) {
        errors.push(`水母箱里没有稀有度为 ${lowerTarget} 的水母`);
        continue;
      }
      for (const jelly of matched) {
        addPlan(jelly.id, metaById.get(jelly.id)?.name ?? jelly.id, 'all');
      }
      continue;
    }

    const meta = metaById.get(token.target) ?? metaByName.get(token.target);
    if (!meta) {
      errors.push(`这片大地(hai)没有名为「${token.target}」的水母`);
      continue;
    }

    const owned = boxMap.get(meta.id) ?? 0;
    if (owned <= 0) {
      errors.push(`水母箱里没有${meta.name}`);
      continue;
    }

    addPlan(meta.id, meta.name, token.quantity);
  }

  const items: ResolvedDropItem[] = [];
  for (const [id, plan] of aggregated) {
    const owned = boxMap.get(id) ?? 0;
    if (!plan.isAll && plan.count > owned) {
      errors.push(`水母箱里的${plan.name}数量不够（当前 ${owned} 只，需要放生 ${plan.count} 只）`);
      continue;
    }
    items.push({
      id,
      name: plan.name,
      count: plan.isAll ? owned : plan.count,
      isAll: plan.isAll
    });
  }

  return { errors, items };
}

export async function dropJellyfish(
  ctx: Context,
  userId: string,
  platform: string,
  params: readonly string[]
): Promise<DropJellyfishResult> {
  const tokens = parseDropArgs(params);
  if (tokens.length === 0) {
    return {
      ok: false,
      reason: '请提供要放生的水母名称和数量\n例：「水母箱 放生 普通水母 10」或「水母箱 放生 normal all」'
    };
  }

  return boxLock.run(`${platform}:${userId}`, async () => {
    const box = await getOrCreateJellyfishBox(ctx, userId, platform);
    const allMeta = await ctx.database.get('mzk_jellyfish_meta', {});
    const { errors, items } = resolveDropPlan(tokens, box, allMeta);

    if (errors.length > 0) {
      return {
        ok: false,
        reason: `放生失败，请检查输入的信息：\n${errors.join('\n')}`
      };
    }

    const dropMap = new Map(items.map((item) => [item.id, item]));
    const updated: Jellyfish[] = [];
    for (const jelly of box.jellyfish) {
      const plan = dropMap.get(jelly.id);
      if (!plan) {
        if (jelly.number > 0) updated.push({ ...jelly });
        continue;
      }
      const remaining = plan.isAll ? 0 : jelly.number - plan.count;
      if (remaining > 0) {
        updated.push({ id: jelly.id, number: remaining });
      }
    }

    box.jellyfish = updated;
    await ctx.database.set('mzk_jellyfish_box', box.user_id, {
      jellyfish: box.jellyfish
    });

    return { ok: true, dropped: items, box };
  });
}

export async function setJellyfishBoxStyle(
  ctx: Context,
  userId: string,
  platform: string,
  rawStyle: string
): Promise<{ ok: true; style: DrawStyle } | { ok: false; reason: string }> {
  const style = resolveDrawStyle(rawStyle);
  if (!style) {
    return {
      ok: false,
      reason: '暂不支持该样式，目前可选样式：normal（默认）、pixel（像素）'
    };
  }

  return boxLock.run(`${platform}:${userId}`, async () => {
    const box = await getOrCreateJellyfishBox(ctx, userId, platform);
    box.draw_style = style;
    await ctx.database.set('mzk_jellyfish_box', box.user_id, {
      draw_style: style
    });
    return { ok: true, style };
  });
}
