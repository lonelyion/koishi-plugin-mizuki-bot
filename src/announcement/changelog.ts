import * as fs from 'fs/promises';
import * as path from 'path';
import { Context } from 'koishi';
import { Config } from '../config';
import { ChangelogData, ChangelogSection } from './types';

export const DEFAULT_CHANGELOG_REL_PATH = path.join('data', 'mizuki-bot', 'data', 'changelog.json');

export const DEFAULT_CHANGELOG: ChangelogData = {
  version: '1.2.0',
  date: '2026-11-20',
  title: '水月终端系统升级',
  subtitle: 'PRTS // UPDATE DISPATCH',
  summary: '新增干员属性推理、水月深海运势签与厨房投喂玩法，水母图鉴同步扩充至 26 种！',
  sections: [
    {
      tag: 'NEW',
      title: '新增玩法',
      items: [
        '「猜干员」（方舟 Wordle）：支持 4~6 星标准 / 六星专场 / 全星级困难模式，PRTS 战术面板呈现',
        '「今日运势」：每日抽取深海运势签、随机立绘今日守护干员与深海厨房食材',
        '「水母箱.投喂」：使用食材调制暖汤 / 冰沙 / 秘制料理，调节水箱温盐度并触发事件'
      ]
    },
    {
      tag: 'UPDATE',
      title: '内容扩充',
      items: [
        '水母图鉴新增 11 种明日方舟主题与创意水母（含绝世与特别稀有度），现共 26 种',
        '优化部分水母图鉴文案，使图鉴风味更贴合水月陪伴体验'
      ]
    },
    {
      tag: 'FIX',
      title: '体验优化',
      items: [
        '自动识别 QQ 群昵称与用户名，无需再弹窗设置称呼（仍可随时用「叫我」自定义）',
        '修复水母箱事件概率、保护机制、刷新冷却与并发操作等若干问题'
      ]
    }
  ],
  footer: '发送「帮助」查看全部指令 · 祝博士今日探索顺利'
};

export function resolveChangelogPath(ctx: Context, config: Config): string {
  const configured = config.changelogPath?.trim();
  if (!configured) {
    return path.join(ctx.baseDir, DEFAULT_CHANGELOG_REL_PATH);
  }
  return path.isAbsolute(configured) ? configured : path.resolve(ctx.baseDir, configured);
}

export function validateChangelogData(raw: unknown): ChangelogData {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('changelog.json 根节点必须是一个 JSON 对象');
  }
  const obj = raw as Record<string, unknown>;

  const version = typeof obj.version === 'string' ? obj.version.trim() : '';
  if (!version) {
    throw new Error('changelog.json 缺少非空的 version 字段（例如 "1.2.0"）');
  }

  const title = typeof obj.title === 'string' ? obj.title.trim() : '';
  if (!title) {
    throw new Error('changelog.json 缺少非空的 title 字段');
  }

  const date = typeof obj.date === 'string' && obj.date.trim()
    ? obj.date.trim()
    : new Date().toISOString().slice(0, 10);

  if (!Array.isArray(obj.sections) || obj.sections.length === 0) {
    throw new Error('changelog.json 的 sections 必须是非空数组');
  }

  const sections: ChangelogSection[] = obj.sections.map((sec, idx) => {
    if (!sec || typeof sec !== 'object' || Array.isArray(sec)) {
      throw new Error(`sections[${idx}] 必须是一个对象`);
    }
    const secObj = sec as Record<string, unknown>;
    const secTitle = typeof secObj.title === 'string' ? secObj.title.trim() : '';
    if (!secTitle) {
      throw new Error(`sections[${idx}] 缺少非空的 title 字段`);
    }
    if (!Array.isArray(secObj.items)) {
      throw new Error(`sections[${idx}].items 必须是字符串数组`);
    }
    const items = secObj.items
      .map((item) => (typeof item === 'string' ? item.trim() : ''))
      .filter((item) => item.length > 0);
    if (items.length === 0) {
      throw new Error(`sections[${idx}].items 至少需要 1 条非空内容`);
    }
    const tag = typeof secObj.tag === 'string' && secObj.tag.trim()
      ? secObj.tag.trim().toUpperCase()
      : 'UPDATE';
    return { tag, title: secTitle, items };
  });

  const subtitle = typeof obj.subtitle === 'string' && obj.subtitle.trim()
    ? obj.subtitle.trim()
    : undefined;
  const summary = typeof obj.summary === 'string' && obj.summary.trim()
    ? obj.summary.trim()
    : undefined;
  const footer = typeof obj.footer === 'string' && obj.footer.trim()
    ? obj.footer.trim()
    : undefined;

  return {
    version,
    date,
    title,
    subtitle,
    summary,
    sections,
    footer
  };
}

/**
 * 确保 changelog.json 存在：若不存在，则写入一份可直接编辑的默认模板。
 */
export async function ensureChangelogFile(ctx: Context, config: Config): Promise<string> {
  const filePath = resolveChangelogPath(ctx, config);
  try {
    await fs.access(filePath);
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify(DEFAULT_CHANGELOG, null, 2) + '\n', 'utf-8');
  }
  return filePath;
}

/**
 * 读取并校验更新日志 JSON（每次预览/推送均实时读取磁盘文件，编辑后无需重启即可生效）。
 */
export async function loadChangelog(ctx: Context, config: Config): Promise<{ data: ChangelogData; filePath: string }> {
  const filePath = await ensureChangelogFile(ctx, config);
  const content = await fs.readFile(filePath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`更新日志 JSON 语法错误 (${filePath})：${msg}`);
  }
  return {
    data: validateChangelogData(parsed),
    filePath
  };
}
