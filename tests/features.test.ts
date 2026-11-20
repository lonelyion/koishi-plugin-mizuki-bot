import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Context } from 'koishi';
import mock from '@koishijs/plugin-mock';
import memory from '@koishijs/plugin-database-memory';
import * as mizukiBot from '../src/index';
import { OperatorProfile } from '../src/arknights/data';
import { generateDailyFortune, hashSeed } from '../src/arknights/fortune';
import {
  buildWordleHint,
  compareOperatorGuess,
  findOperatorByQuery,
  pickWordleTarget,
  WordleGameManager
} from '../src/arknights/wordle';
import { resolveDishFlavor } from '../src/jellyfish/kitchen';

const sampleOperators: OperatorProfile[] = [
  {
    id: 'char_437_mizuki',
    name: '水月',
    appellation: 'Mizuki',
    rarity: 6,
    profession: 'SPECIAL',
    professionName: '特种',
    subProfessionId: 'stalker',
    subProfessionName: '伏击客',
    position: 'MELEE',
    positionName: '近战位',
    factionId: 'higashi',
    factionName: '东',
    allFactionIds: ['higashi'],
    tags: ['输出', '控场']
  },
  {
    id: 'char_103_angel',
    name: '能天使',
    appellation: 'Exusiai',
    rarity: 6,
    profession: 'SNIPER',
    professionName: '狙击',
    subProfessionId: 'fastshot',
    subProfessionName: '速射手',
    position: 'RANGED',
    positionName: '远程位',
    factionId: 'lungmen',
    factionName: '炎-龙门',
    allFactionIds: ['lungmen', 'penguin'],
    tags: ['输出']
  },
  {
    id: 'char_174_slbell',
    name: '初雪',
    appellation: 'Pramanix',
    rarity: 5,
    profession: 'SUPPORT',
    professionName: '辅助',
    subProfessionId: 'underminer',
    subProfessionName: '削弱者',
    position: 'RANGED',
    positionName: '远程位',
    factionId: 'kjerag',
    factionName: '谢拉格',
    allFactionIds: ['kjerag', 'karlan'],
    tags: ['削弱']
  },
  {
    id: 'char_2014_nian',
    name: '年',
    appellation: 'Nian',
    rarity: 6,
    profession: 'TANK',
    professionName: '重装',
    subProfessionId: 'protector',
    subProfessionName: '铁卫',
    position: 'MELEE',
    positionName: '近战位',
    factionId: 'yan',
    factionName: '炎',
    allFactionIds: ['yan', 'sui'],
    tags: ['防护', '支援']
  },
  {
    id: 'char_325_bison',
    name: '狮蝎',
    appellation: 'Manticore',
    rarity: 5,
    profession: 'SPECIAL',
    professionName: '特种',
    subProfessionId: 'stalker',
    subProfessionName: '伏击客',
    position: 'MELEE',
    positionName: '近战位',
    factionId: 'sargon',
    factionName: '萨尔贡',
    allFactionIds: ['sargon'],
    tags: ['输出', '生存']
  }
];

function registerMockServices(app: App) {
  app.provide('cron');
  app.set('cron', (() => () => {}) as unknown as Context['cron']);
  app.provide('http');
  app.set('http', {
    get: vi.fn().mockRejectedValue(new Error('offline in test'))
  } as unknown as Context['http']);
  app.provide('skia');
  app.set('skia', {
    Canvas: class MockCanvas {
      width: number;
      height: number;
      constructor(w: number, h: number) {
        this.width = w;
        this.height = h;
      }
      getContext() {
        return new Proxy({}, {
          get: (_target, prop) => {
            if (prop === 'measureText') {
              return (text: string) => ({ width: text.length * 14, actualBoundingBoxAscent: 32 });
            }
            if (prop === 'getImageData') {
              return () => ({
                width: 2,
                height: 2,
                data: new Uint8ClampedArray([
                  0, 0, 0, 255, 0, 0, 0, 255,
                  0, 0, 0, 255, 0, 0, 0, 255
                ])
              });
            }
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') {
              return () => ({ addColorStop: () => {} });
            }
            return () => {};
          },
          set: () => true
        });
      }
      async toBuffer() {
        return Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      }
    },
    loadImage: async () => ({ width: 64, height: 64 }),
    FontLibrary: { use: () => {} }
  } as unknown as Context['skia']);
}

describe('Arknights Wordle logic', () => {
  it('compares rarity direction, branch/profession, related factions, and partial tags accurately', () => {
    const mizuki = sampleOperators[0];
    const exusiai = sampleOperators[1];
    const nian = sampleOperators[3];
    const manticore = sampleOperators[4];

    // 狮蝎(5★ 特种·伏击客, 萨尔贡) vs 水月(6★ 特种·伏击客, 东)
    const cmp1 = compareOperatorGuess(manticore, mizuki);
    expect(cmp1.isCorrect).toBe(false);
    expect(cmp1.rarity.match).toBe('close');
    expect(cmp1.rarity.direction).toBe('up');
    expect(cmp1.profession.match).toBe('exact');
    expect(cmp1.subProfession.match).toBe('exact');
    expect(cmp1.faction.match).toBe('miss');

    // 能天使(炎-龙门) vs 年(炎) -> 关联文化圈判定为 close
    const cmp2 = compareOperatorGuess(exusiai, nian);
    expect(cmp2.faction.match).toBe('close');

    // 猜中本人
    const cmpWin = compareOperatorGuess(mizuki, mizuki);
    expect(cmpWin.isCorrect).toBe(true);
    expect(cmpWin.faction.match).toBe('exact');
  });

  it('matches Chinese name and case-insensitive English appellation', () => {
    expect(findOperatorByQuery(sampleOperators, '水月')?.id).toBe('char_437_mizuki');
    expect(findOperatorByQuery(sampleOperators, 'mizuki')?.id).toBe('char_437_mizuki');
    expect(findOperatorByQuery(sampleOperators, 'EXUSIAI')?.id).toBe('char_103_angel');
    expect(findOperatorByQuery(sampleOperators, '不存在干员')).toBeUndefined();
  });

  it('tracks active games, prevents duplicate guesses, and expires idle games', () => {
    const mgr = new WordleGameManager();
    const game = mgr.start('ch1', sampleOperators, 'six', () => 0, 1000);
    expect(game.target.id).toBe('char_437_mizuki');
    expect(buildWordleHint(game.target)).toContain('M');

    const g1 = mgr.submitGuess('ch1', sampleOperators[1], 2000);
    expect(g1.ok).toBe(true);

    // 重复猜同一干员被拒绝
    const dup = mgr.submitGuess('ch1', sampleOperators[1], 3000);
    expect(dup.ok).toBe(false);

    // 猜中后自动结束对局
    const win = mgr.submitGuess('ch1', sampleOperators[0], 4000);
    expect(win.ok && win.game.status === 'won').toBe(true);
    expect(mgr.getActive('ch1', 4500)).toBeUndefined();
  });

  it('downweights 5-star operators in normal mode regardless of 5-star pool size', () => {
    // 构造 20 个 5 星 vs 1 个 6 星，按权重 6 星仍应占约 65/(65+15) = 81.25%
    const skewedPool: OperatorProfile[] = [
      sampleOperators[0], // 6★
      ...Array.from({ length: 20 }, (_, i) => ({
        ...sampleOperators[2],
        id: `char_5star_${i}`,
        name: `五星${i}`
      }))
    ];

    let sixCount = 0;
    const total = 1000;
    for (let i = 0; i < total; i++) {
      const picked = pickWordleTarget(skewedPool, 'normal', () => i / total);
      if (picked.rarity === 6) sixCount += 1;
    }
    // 仅存在 6★(0.65) 与 5★(0.15) 时，6★ 占比应为 0.65 / 0.80 = 81.25%
    expect(sixCount).toBeGreaterThan(780);
    expect(sixCount).toBeLessThan(840);
  });
});

describe('Daily fortune & kitchen logic', () => {
  it('generates deterministic daily fortune for the same seed and date', () => {
    const seed = hashSeed('mizuki-fortune:qq:u1:2026-11-20');
    const f1 = generateDailyFortune(seed, '2026-11-20', sampleOperators);
    const f2 = generateDailyFortune(seed, '2026-11-20', sampleOperators);
    expect(f1).toEqual(f2);
    expect(f1.goodThings[0]).not.toBe(f1.goodThings[1]);
    expect(f1.badThings[0]).not.toBe(f1.badThings[1]);
  });

  it('resolves dish flavor aliases', () => {
    expect(resolveDishFlavor('暖汤')).toBe('warm');
    expect(resolveDishFlavor('冰沙')).toBe('cold');
    expect(resolveDishFlavor('秘制')).toBe('salty');
    expect(resolveDishFlavor('不存在')).toBeUndefined();
  });
});

describe('Fortune + Kitchen integration commands', () => {
  let app: App;

  beforeEach(async () => {
    app = new App();
    app.plugin(memory);
    app.plugin(mock);
    registerMockServices(app);
    app.plugin(mizukiBot, { test_account: 'tester' });
    await app.start();

    await app.database.upsert('mzk_jellyfish_meta', [
      {
        id: 'normal_jellyfish',
        name: '普通水母',
        group: 'normal',
        description: '普通的水母普通的游',
        reproductive_rate: 0.01,
        living_location: ['中'],
        protected: false,
        draw: { size: 32, bounce: true, speed: 'normal' }
      },
      {
        id: 'cat_jellyfish',
        name: '猫猫水母',
        group: 'good',
        description: '咕噜咕噜',
        reproductive_rate: 0.5,
        living_location: ['中'],
        protected: false,
        draw: { size: 32, bounce: true, speed: 'normal' }
      }
    ]);
  });

  afterEach(async () => {
    await app.stop();
  });

  it('grants ingredients via 今日运势 and allows 水母箱.投喂 with daily cap', async () => {
    const client = app.mock.client('player_a');

    // 未抽签无食材时投喂给出友好引导
    await client.shouldReply('投喂', /没有深海食材/);

    // 抽今日运势返回运势卡图片并赠送 2~3 份食材
    await client.shouldReply('今日运势', /<img /);

    // 同一天重复抽签仍返回运势卡，且不会重复叠加食材
    const [stateAfterFirst] = await app.database.get('mzk_daily_state', {});
    const initialIngredients = stateAfterFirst.ingredients;
    expect(initialIngredients).toBeGreaterThanOrEqual(2);

    await client.shouldReply('今日运势', /<img /);
    const [stateAfterSecond] = await app.database.get('mzk_daily_state', {});
    expect(stateAfterSecond.ingredients).toBe(initialIngredients);

    // 使用食材投喂暖汤 -> 返回水母箱图片 + 剩余食材提示
    await client.shouldReply('投喂 暖汤', /剩余深海食材/);
    await client.shouldReply('投喂 冰沙', /今日已投喂 2\/2/);

    // 第 3 次投喂命中每日上限
    await client.shouldReply('投喂', /每日最多投喂 2 次/);
  });
});
