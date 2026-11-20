import { describe, expect, it } from 'vitest';
import { EventMeta, JellyfishBox, JellyfishMeta } from '../src/database';
import {
  computeCatchCount,
  computeRefreshHours,
  parseDropArgs,
  resolveDrawStyle,
  resolveDropPlan,
  simulateBoxEventsPure
} from '../src/jellyfish/service';
import { diffManifests, isNewerArknightsVersion, isValidManifest } from '../src/resources/updater';

const sampleMeta: JellyfishMeta[] = [
  {
    id: 'normal_jellyfish',
    name: '普通水母',
    group: 'normal',
    description: '普通的水母普通的游',
    reproductive_rate: 0.5,
    living_location: ['中'],
    protected: false,
    draw: { size: 32, bounce: true, speed: 'normal' }
  },
  {
    id: 'aurelia_aurita',
    name: '海月水母',
    group: 'good',
    description: '海月水母',
    reproductive_rate: 0.5,
    living_location: ['中'],
    protected: false,
    draw: { size: 32, bounce: true, speed: 'normal' }
  },
  {
    id: 'prts_mzk',
    name: '伊祖米克，生态泉源',
    group: 'perfect',
    description: '海嗣',
    reproductive_rate: 0.5,
    living_location: ['中'],
    protected: true,
    draw: { size: 40, bounce: true, speed: 'normal' }
  }
];

const sampleEvents: EventMeta[] = [
  { id: 'happy', name: '水母在欢快地游泳', description: '什么事都没发生', type: 'normal', probability: 0.05, relation: { jellyfish: [], medal: [] } },
  { id: 'eat', name: '水母在欢快地进食', description: '什么事都没发生', type: 'normal', probability: 0.002, relation: { jellyfish: [], medal: [] } },
  { id: 'whirlpool', name: '水母被旋涡卷走', description: '水母遇到旋涡被冲走了', type: 'reduce', probability: 0.05, relation: { jellyfish: [], medal: [] } },
  { id: 'breed', name: '水母繁殖', description: '繁殖', type: 'breed', probability: 0.05, relation: { jellyfish: [], medal: [] } }
];

const makeBox = (jellyfish: { id: string; number: number }[], hoursAgo = 10): JellyfishBox => ({
  user_id: 1,
  last_catch_time: new Date(Date.now() - hoursAgo * 3600_000),
  last_refresh_time: new Date(Date.now() - hoursAgo * 3600_000),
  jellyfish,
  decoration: [],
  salinity: 25,
  temperature: 25,
  draw_style: 'normal'
});

describe('jellyfish domain logic', () => {
  it('computeRefreshHours is monotonic and bounded', () => {
    const H = 3600_000;
    expect(computeRefreshHours(0)).toBe(0);
    expect(computeRefreshHours(0.5 * H)).toBe(0);
    expect(computeRefreshHours(1 * H)).toBe(1);
    expect(computeRefreshHours(24 * H)).toBe(24);
    expect(computeRefreshHours(72 * H)).toBe(36);
    expect(computeRefreshHours(73 * H)).toBeGreaterThanOrEqual(36);
    expect(computeRefreshHours(500 * H)).toBe(48);
  });

  it('computeCatchCount scales down as box fills up', () => {
    expect(computeCatchCount(0, 0, () => 0)).toBe(4);
    expect(computeCatchCount(0, 0, () => 0.99)).toBe(6);
    expect(computeCatchCount(1, 5, () => 0)).toBe(3);
    expect(computeCatchCount(2, 15, () => 0)).toBe(2);
    expect(computeCatchCount(3, 30, () => 0)).toBe(1);
    expect(computeCatchCount(5, 80, () => 0.99)).toBe(1);
  });

  it('protected jellyfish is immune to whirlpool reduce events', () => {
    const metaMap = new Map(sampleMeta.map((m) => [m.id, m]));
    const onlyWhirlpool = sampleEvents.filter((e) => e.type === 'reduce');
    const box = makeBox([{ id: 'prts_mzk', number: 1 }], 24);
    const result = simulateBoxEventsPure({
      box,
      metaMap,
      eventMetas: onlyWhirlpool,
      now: new Date(),
      isTestAccount: false,
      rng: () => 0.99
    });
    expect(result.refreshed).toBe(true);
    expect(result.jellyfish).toEqual([{ id: 'prts_mzk', number: 1 }]);
    expect(result.events).toEqual([]);
  });

  it('whirlpool removes non-protected jellyfish and cleans up zero entries', () => {
    const metaMap = new Map(sampleMeta.map((m) => [m.id, m]));
    const onlyWhirlpool: EventMeta[] = [
      { id: 'whirlpool', name: '水母被旋涡卷走', description: '被冲走', type: 'reduce', probability: 1, relation: { jellyfish: [], medal: [] } }
    ];
    const box = makeBox([{ id: 'normal_jellyfish', number: 1 }], 2);
    const result = simulateBoxEventsPure({
      box,
      metaMap,
      eventMetas: onlyWhirlpool,
      now: new Date(),
      isTestAccount: false,
      rng: () => 0.99 // skip reproduction fractional roll
    });
    expect(result.jellyfish).toEqual([]);
    expect(result.events).toHaveLength(1);
    expect(result.events[0].description).toContain('普通水母');
  });

  it('deduplicates single-display events (happy, eat)', () => {
    const metaMap = new Map(sampleMeta.map((m) => [m.id, m]));
    const onlyHappy: EventMeta[] = [
      { id: 'happy', name: '水母在欢快地游泳', description: '什么事都没发生', type: 'normal', probability: 1, relation: { jellyfish: [], medal: [] } }
    ];
    const box = makeBox([{ id: 'normal_jellyfish', number: 1 }], 5);
    const result = simulateBoxEventsPure({
      box,
      metaMap,
      eventMetas: onlyHappy,
      now: new Date(),
      isTestAccount: false,
      rng: () => 0.99
    });
    expect(result.events.filter((e) => e.id === 'happy')).toHaveLength(1);
  });

  it('parseDropArgs and resolveDropPlan reject negative, zero, float and merged over-drop', () => {
    const box = makeBox([
      { id: 'normal_jellyfish', number: 6 },
      { id: 'aurelia_aurita', number: 3 }
    ]);

    const bad = resolveDropPlan(parseDropArgs(['普通水母', '-5', '海月水母', '0', '普通水母', '1.5']), box, sampleMeta);
    expect(bad.errors).toHaveLength(3);

    // 重复输入普通水母 5 + 普通水母 5 = 10 > 6，应该被合并后拒绝
    const duplicateOver = resolveDropPlan(parseDropArgs(['普通水母', '5', '普通水母', '5']), box, sampleMeta);
    expect(duplicateOver.errors).toHaveLength(1);
    expect(duplicateOver.errors[0]).toContain('数量不够');

    // 稀有度支持大小写不敏感
    const byRarity = resolveDropPlan(parseDropArgs(['NORMAL', 'all']), box, sampleMeta);
    expect(byRarity.errors).toHaveLength(0);
    expect(byRarity.items).toEqual([{ id: 'normal_jellyfish', name: '普通水母', count: 6, isAll: true }]);

    // 稀有度带数字报错
    const rarityNum = resolveDropPlan(parseDropArgs(['normal', '2']), box, sampleMeta);
    expect(rarityNum.errors).toHaveLength(1);
  });

  it('resolveDrawStyle handles aliases', () => {
    expect(resolveDrawStyle('normal')).toBe('normal');
    expect(resolveDrawStyle('默认')).toBe('normal');
    expect(resolveDrawStyle('PIXEL')).toBe('pixel');
    expect(resolveDrawStyle('像素')).toBe('pixel');
    expect(resolveDrawStyle('unknown')).toBeUndefined();
  });

  it('isNewerArknightsVersion compares dotted-hyphenated versions correctly', () => {
    expect(isNewerArknightsVersion('26-10-08-04-51-28-56071834', '00-00-00-00-00-00-abcdef')).toBe(true);
    expect(isNewerArknightsVersion('26-10-08-04-51-28-56071834', '26-10-08-04-51-28-56071834')).toBe(false);
    expect(isNewerArknightsVersion('26-09-01-00-00-00-aaaa', '26-10-08-04-51-28-bbbb')).toBe(false);
  });

  it('manifest validation and diffing computes exact incremental changes', () => {
    const local = {
      schema: 1,
      version: 100,
      files: {
        'font/NotoSansSC-Regular.ttf': { size: 1000, sha256: 'aaa' },
        'data/jellyfish.json': { size: 200, sha256: 'old_json' },
        'image/obsolete.png': { size: 50, sha256: 'old_img' }
      }
    };
    const remote = {
      schema: 1,
      version: 101,
      files: {
        'font/NotoSansSC-Regular.ttf': { size: 1000, sha256: 'aaa' },
        'data/jellyfish.json': { size: 220, sha256: 'new_json' },
        'image/jellyfish/default/cat_jellyfish.png': { size: 150, sha256: 'cat' }
      }
    };

    expect(isValidManifest(remote)).toBe(true);
    expect(isValidManifest({ schema: 2 })).toBe(false);

    const diff = diffManifests(remote, local);
    expect(diff.toDownload).toEqual([
      'data/jellyfish.json',
      'image/jellyfish/default/cat_jellyfish.png'
    ]);
    expect(diff.toDelete).toEqual(['image/obsolete.png']);
  });
});
