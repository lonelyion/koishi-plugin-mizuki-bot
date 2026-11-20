import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App, Bot, Context, Session } from 'koishi';
import memory from '@koishijs/plugin-database-memory';
import mock from '@koishijs/plugin-mock';
import { DEFAULT_CHANGELOG, loadChangelog, validateChangelogData } from '../src/announcement/changelog';
import { getGroupStatusSummary, markGroupInactive, recordGroupActivity, toggleGroupMuted } from '../src/announcement/groups';
import { isAnnouncementAdmin } from '../src/announcement';
import {
  executeBroadcast,
  extractQqErrorCode,
  planBroadcast,
  QQ_ERR_NO_PROACTIVE_PERMISSION,
  QQ_ERR_NOT_IN_GROUP,
  QQ_ERR_RATE_LIMITED
} from '../src/announcement/service';
import { Config } from '../src/config';
import * as mizukiBot from '../src/index';

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
              return (text: string) => ({ width: text.length * 14, actualBoundingBoxAscent: 24 });
            }
            if (prop === 'createLinearGradient') {
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

describe('changelog validation & file loading', () => {
  it('validates well-formed changelog JSON and normalizes tags', () => {
    const parsed = validateChangelogData({
      version: '1.3.0',
      date: '2026-12-01',
      title: '冬季更新',
      sections: [
        { tag: 'new', title: '新内容', items: ['功能 A', '  '] }
      ]
    });
    expect(parsed.version).toBe('1.3.0');
    expect(parsed.sections[0].tag).toBe('NEW');
    expect(parsed.sections[0].items).toEqual(['功能 A']);
  });

  it('rejects malformed changelog JSON with clear messages', () => {
    expect(() => validateChangelogData(null)).toThrow(/JSON 对象/);
    expect(() => validateChangelogData({ version: '', title: 'x', sections: [] })).toThrow(/version/);
    expect(() => validateChangelogData({ version: '1.0', title: 'x', sections: [] })).toThrow(/sections/);
  });
});

describe('QQ error code extraction', () => {
  it('extracts error code from AggregateError wrapping Cordis HTTP error', () => {
    const httpErr = Object.assign(new Error('Request failed'), {
      response: { data: { code: QQ_ERR_NO_PROACTIVE_PERMISSION, message: 'no permission' } }
    });
    const aggErr = new AggregateError([httpErr], 'send failed');
    expect(extractQqErrorCode(aggErr)).toBe(QQ_ERR_NO_PROACTIVE_PERMISSION);
  });

  it('extracts error code from direct code or message text', () => {
    expect(extractQqErrorCode({ code: QQ_ERR_NOT_IN_GROUP })).toBe(QQ_ERR_NOT_IN_GROUP);
    expect(extractQqErrorCode(new Error('QQ API failed: 40034100 rate limit'))).toBe(QQ_ERR_RATE_LIMITED);
    expect(extractQqErrorCode(new Error('generic network error'))).toBeNull();
  });
});

describe('announcement admin check', () => {
  const baseConfig = Config({
    admin_users: ['admin-1'],
    test_account: 'tester-1'
  });

  it('authorizes admin_users, test_account, and Koishi authority >= 3', () => {
    expect(isAnnouncementAdmin({ userId: 'admin-1' } as Session, baseConfig)).toBe(true);
    expect(isAnnouncementAdmin({ userId: 'tester-1' } as Session, baseConfig)).toBe(true);
    expect(isAnnouncementAdmin({ userId: 'other', user: { authority: 3 } } as unknown as Session, baseConfig)).toBe(true);
    expect(isAnnouncementAdmin({ userId: 'other', user: { authority: 1 } } as unknown as Session, baseConfig)).toBe(false);
  });
});

describe('group tracking, broadcast planning, execution & commands', () => {
  let app: App;
  let tmpDir: string;
  let config: Config;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'mizuki-announce-'));
    app = new App({ baseDir: tmpDir });
    app.plugin(memory);
    app.plugin(mock);
    registerMockServices(app);

    config = Config({
      admin_users: ['admin-u1'],
      test_account: 'tester-u1',
      changelogPath: path.join(tmpDir, 'changelog.json'),
      broadcast_interval_ms: 200
    });
    app.plugin(mizukiBot, config);
    await app.start();
  });

  afterEach(async () => {
    await app.stop();
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('auto-creates editable changelog.json and picks up live edits immediately', async () => {
    const first = await loadChangelog(app, config);
    expect(first.data.version).toBe(DEFAULT_CHANGELOG.version);

    const edited = {
      ...DEFAULT_CHANGELOG,
      version: '1.2.1',
      title: '热修复公告'
    };
    await fs.writeFile(first.filePath, JSON.stringify(edited, null, 2), 'utf-8');

    const second = await loadChangelog(app, config);
    expect(second.data.version).toBe('1.2.1');
    expect(second.data.title).toBe('热修复公告');
  });

  it('tracks groups, filters muted/restricted/already-notified, and handles QQ error codes on broadcast', async () => {
    await recordGroupActivity(app, { platform: 'qq', selfId: 'bot-1', guildId: 'g-ok', channelId: 'g-ok' });
    await recordGroupActivity(app, { platform: 'qq', selfId: 'bot-1', guildId: 'g-noperm', channelId: 'g-noperm' });
    await recordGroupActivity(app, { platform: 'qq', selfId: 'bot-1', guildId: 'g-kicked', channelId: 'g-kicked' });
    await recordGroupActivity(app, { platform: 'qq', selfId: 'bot-1', guildId: 'g-ratelimit', channelId: 'g-ratelimit' });
    await recordGroupActivity(app, { platform: 'qq', selfId: 'bot-1', guildId: 'g-muted', channelId: 'g-muted' });
    await toggleGroupMuted(app, { platform: 'qq', selfId: 'bot-1', guildId: 'g-muted', channelId: 'g-muted' });

    const plan = await planBroadcast(app, config, DEFAULT_CHANGELOG);
    expect(plan.totalActive).toBe(5);
    expect(plan.skippedMuted).toBe(1);
    expect(plan.targets.map((g) => g.channel_id).sort()).toEqual(['g-kicked', 'g-noperm', 'g-ok', 'g-ratelimit']);

    let rateLimitAttempts = 0;
    const fakeSendMessage = vi.fn(async (channelId: string) => {
      if (channelId === 'g-noperm') {
        throw new AggregateError([
          { response: { data: { code: QQ_ERR_NO_PROACTIVE_PERMISSION } } }
        ]);
      }
      if (channelId === 'g-kicked') {
        throw new AggregateError([
          { response: { data: { code: QQ_ERR_NOT_IN_GROUP } } }
        ]);
      }
      if (channelId === 'g-ratelimit') {
        rateLimitAttempts += 1;
        if (rateLimitAttempts === 1) {
          throw new AggregateError([
            { response: { data: { code: QQ_ERR_RATE_LIMITED } } }
          ]);
        }
      }
      return ['msg-1'];
    });

    const fakeBot = {
      platform: 'qq',
      selfId: 'bot-1',
      sendMessage: fakeSendMessage
    } as unknown as Bot;
    app.bots.push(fakeBot);

    const noSleep = vi.fn(async () => {});
    const result = await executeBroadcast(
      app,
      config,
      DEFAULT_CHANGELOG,
      Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      plan.targets,
      {},
      noSleep
    );

    expect(result.sent).toBe(2); // g-ok + g-ratelimit (after retry)
    expect(result.noPermission).toBe(1);
    expect(result.notInGroup).toBe(1);
    expect(result.failed).toBe(0);
    expect(rateLimitAttempts).toBe(2);

    const summary = await getGroupStatusSummary(app, DEFAULT_CHANGELOG.version);
    expect(summary.active).toBe(4);
    expect(summary.inactive).toBe(1);
    expect(summary.noPermission).toBe(1);
    expect(summary.notifiedCurrent).toBe(2);

    // 再次规划同版本时，已成功推送、无权限、已退群与免打扰的群均应自动跳过
    const secondPlan = await planBroadcast(app, config, DEFAULT_CHANGELOG);
    expect(secondPlan.targets).toHaveLength(0);
    expect(secondPlan.skippedAlreadyNotified).toBe(2);
    expect(secondPlan.skippedNoPermission).toBe(1);
    expect(secondPlan.skippedMuted).toBe(1);

    // markGroupInactive 测试
    await markGroupInactive(app, { platform: 'qq', selfId: 'bot-1', channelId: 'g-ok' });
    const afterLeave = await getGroupStatusSummary(app, DEFAULT_CHANGELOG.version);
    expect(afterLeave.active).toBe(3);
  });

  it('requires admin permission and two-step confirmation for 更新公告.推送', async () => {
    const normalClient = app.mock.client('normal-user', 'group-1');
    const denied = await normalClient.receive('更新公告.推送');
    expect(denied.join('\n')).toContain('仅管理员可执行');

    // normalClient 在 group-1 发言后会被群采集器自动收录；再手动收录 group-2，共 2 个活跃群
    await recordGroupActivity(app, { platform: 'mock', selfId: '514', guildId: 'group-2', channelId: 'group-2' });

    const adminClient = app.mock.client('admin-u1', 'group-1');
    const previewRes = await adminClient.receive('更新公告.预览');
    expect(previewRes.join('\n')).toContain('更新公告预览');
    expect(previewRes.join('\n')).toContain('本次待推送：2 个');

    // 取消确认测试
    const cancelReplies = await adminClient.receive('更新公告.推送');
    expect(cancelReplies.join('\n')).toContain('更新公告.确认');
    const afterCancel = await adminClient.receive('更新公告.取消');
    expect(afterCancel.join('\n')).toContain('已取消待执行的更新公告推送');

    // MockBot.sendMessage 仅支持带 options.session 的被动回复，这里为无 session 的主动推送提供桩函数以验证调用参数
    const bot = app.bots[0];
    const origSend = bot.sendMessage.bind(bot);
    const proactiveTargets: string[] = [];
    const sendSpy = vi.spyOn(bot, 'sendMessage').mockImplementation(async (channelId, content, guildId, options) => {
      if (!options?.session) {
        proactiveTargets.push(channelId);
        return [`proactive-${channelId}`];
      }
      return origSend(channelId, content, guildId, options);
    });

    // 真正确认推送测试（别名「确认推送」同样生效）
    const askConfirm = await adminClient.receive('更新公告.推送');
    expect(askConfirm.join('\n')).toContain('更新公告.确认');
    const confirmed = await adminClient.receive('确认推送');
    expect(confirmed.join('\n')).toContain('更新公告推送完成');
    expect(confirmed.join('\n')).toContain('发送成功：2');
    expect(proactiveTargets.sort()).toEqual(['group-1', 'group-2']);
    sendSpy.mockRestore();

    // 群内开关测试
    const muteRes = await adminClient.receive('更新公告.开关');
    expect(muteRes.join('\n')).toContain('已关闭本群');
    const unmuteRes = await adminClient.receive('更新公告.开关');
    expect(unmuteRes.join('\n')).toContain('已重新开启本群');
  });
});
