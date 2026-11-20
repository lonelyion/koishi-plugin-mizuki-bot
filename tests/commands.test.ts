import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Context, Session } from 'koishi';
import mock from '@koishijs/plugin-mock';
import memory from '@koishijs/plugin-database-memory';
import * as mizukiBot from '../src/index';
import { catchJellyfish } from '../src/jellyfish/service';
import { extractPlatformNickname, resolveDisplayName } from '../src/utils/user';

// 轻量 mock skia / cron / http 服务，用于无图形、无外网依赖的指令集成测试
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

describe('nickname resolution (QQ API v2 & cross-platform)', () => {
  it('auto-resolves QQ author.username and member_nickname without requiring /叫我', () => {
    const qqGroupSession = {
      platform: 'qq',
      userId: '7A3B9C1D5E2F4A6B8C0D1E3F5A7B9C2D',
      event: {
        user: { id: '7A3B9C1D5E2F4A6B8C0D1E3F5A7B9C2D', name: '海月QQ昵称' }
      },
      qq: {
        d: {
          author: {
            username: '海月QQ昵称',
            member_nickname: '群名片海月'
          }
        }
      }
    } as unknown as Session;

    expect(extractPlatformNickname(qqGroupSession)).toBe('群名片海月');
    expect(resolveDisplayName({ nickname: '' }, qqGroupSession)).toBe('群名片海月');
    // 若用户显式设置了自定义昵称，则优先展示自定义昵称
    expect(resolveDisplayName({ nickname: '我的自定义名' }, qqGroupSession)).toBe('我的自定义名');
  });

  it('falls back cleanly when QQ OpenID has no username', () => {
    const noNameSession = {
      platform: 'qq',
      userId: '7A3B9C1D5E2F4A6B8C0D1E3F5A7B9C2D',
      username: '7A3B9C1D5E2F4A6B8C0D1E3F5A7B9C2D',
      event: {
        user: { id: '7A3B9C1D5E2F4A6B8C0D1E3F5A7B9C2D' }
      }
    } as unknown as Session;

    expect(extractPlatformNickname(noNameSession)).toBeUndefined();
    expect(resolveDisplayName({ nickname: '' }, noNameSession)).toBe('水母饲养员');
  });
});

describe('mizuki-bot plugin commands integration', () => {
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
        id: 'aurelia_aurita',
        name: '海月水母',
        group: 'good',
        description: '海月水母',
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

  it('removes skland and test commands completely', () => {
    expect(app.$commander.get('森空岛.签到')).toBeUndefined();
    expect(app.$commander.get('森空岛.登录')).toBeUndefined();
    expect(app.$commander.get('测试')).toBeUndefined();
    expect(app.$commander.get('水母箱')).toBeDefined();
    expect(app.$commander.get('水母箱.抓水母')).toBeDefined();
    expect(app.$commander.get('猜干员.立绘')).toBeDefined();
  });

  it('handles 叫我 set, inspect, and reset', async () => {
    const client = app.mock.client('user1');
    await client.shouldReply('叫我 阿米娅', '已将你的自定义昵称更新为：阿米娅');
    await client.shouldReply('叫我', /当前称呼：阿米娅（自定义昵称）/);
    await client.shouldReply('叫我 -r', /已清除自定义昵称/);
  });

  it('handles 抓水母, cooldown, 水母统计表, 样式, and 放生 end-to-end', async () => {
    const client = app.mock.client('user2');

    // 空箱统计返回友好提示而不是 12px 坏图
    await client.shouldReply('水母统计表', /还没有水母/);

    // 抓水母返回图片
    await client.shouldReply('抓水母', /<img /);

    // 冷却期内不能再抓
    await client.shouldReply('抓水母', /别抓啦，过/);

    // 切换样式
    await client.shouldReply('样式 pixel', /像素（pixel）/);
    await client.shouldReply('样式 invalid', /暂不支持该样式/);

    // 统计表和图鉴均可正常渲染
    await client.shouldReply('水母统计表', /<img /);
    await client.shouldReply('水母图鉴', /<img /);

    // 放生负数与 0 均被拒绝
    await client.shouldReply('放生 普通水母 -1', /无效/);
    await client.shouldReply('放生 普通水母 0', /无效/);

    // 按 ID 放生全部
    const boxes = await app.database.get('mzk_jellyfish_box', {});
    const ownedId = boxes[0].jellyfish[0].id;
    await client.shouldReply(`放生 ${ownedId} all`, /成功放生/);
  });

  it('does not crash on April 22 even when special group has zero jellyfishes', async () => {
    const april22 = new Date(2026, 3, 22, 12, 0, 0);
    const pluginConfig = mizukiBot.Config({ test_account: 'tester' });
    const result = await catchJellyfish(
      app,
      pluginConfig,
      'tester',
      'mock',
      april22,
      () => 0.999 // 落在原本会选中 special 组的区间
    );
    expect(result.ok).toBe(true);
  });
});
