import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Context } from 'koishi';
import { clearArknightsDataCache } from '../arknights/data';
import { Config } from '../config';
import { EventMeta, JellyfishMeta } from '../database';
import { assetCache } from '../jellyfish/renderer';

const ARKNIGHTS_RES_URLS = [
  'gamedata/excel/character_table.json',
  'gamedata/excel/skin_table.json'
] as const;

const DOWNLOAD_CONCURRENCY = 5;
const HTTP_TIMEOUT_MS = 30_000;

export interface ResourceManifestEntry {
  size: number;
  sha256: string;
}

export interface ResourceManifest {
  schema: number;
  version: number;
  generatedAt?: string;
  files: Record<string, ResourceManifestEntry>;
}

let isUpdatingJellyfish = false;
let isUpdatingArknights = false;

const getErrorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

function resolveSafePath(root: string, relativePath: string): string | null {
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, relativePath);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
    return null;
  }
  return target;
}

function encodeRelativeUrl(relativePath: string): string {
  return relativePath.split('/').map(encodeURIComponent).join('/');
}

function sha256Buffer(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

async function runWithConcurrency<T>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<void>
): Promise<void> {
  let cursor = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const idx = cursor++;
      await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
}

/**
 * 比较形如 "26-10-08-04-51-28-56071834" 的方舟资源版本号。
 * 前 6 段为数值，若数值段分出大小即返回；返回 true 表示 remote 比 local 更新。
 */
export function isNewerArknightsVersion(remoteStr: string, localStr: string): boolean {
  const remote = remoteStr.trim().split('-');
  const local = localStr.trim().split('-');
  for (let i = 0; i < Math.max(remote.length, local.length); i++) {
    const r = remote[i] ?? '0';
    const l = local[i] ?? '0';
    const rn = Number(r);
    const ln = Number(l);
    const cmp = Number.isNaN(rn) || Number.isNaN(ln) ? r.localeCompare(l) : rn - ln;
    if (cmp !== 0) return cmp > 0;
  }
  return false;
}

export function isValidManifest(value: unknown): value is ResourceManifest {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (obj.schema !== 1 || typeof obj.version !== 'number' || !obj.files || typeof obj.files !== 'object') {
    return false;
  }
  return true;
}

/**
 * 计算需要下载和清理的文件列表（纯函数便于单元测试）。
 */
export function diffManifests(
  remote: ResourceManifest,
  local: ResourceManifest | null
): { toDownload: string[]; toDelete: string[] } {
  const localFiles = local?.files ?? {};
  const toDownload: string[] = [];

  for (const [relPath, remoteEntry] of Object.entries(remote.files)) {
    const localEntry = localFiles[relPath];
    if (!localEntry || localEntry.sha256 !== remoteEntry.sha256 || localEntry.size !== remoteEntry.size) {
      toDownload.push(relPath);
    }
  }

  const remoteKeySet = new Set(Object.keys(remote.files));
  const toDelete = Object.keys(localFiles).filter((relPath) => !remoteKeySet.has(relPath));

  return { toDownload, toDelete };
}

async function readLocalVersion(filePath: string, fallback: string): Promise<string> {
  try {
    return (await fs.readFile(filePath, 'utf-8')).trim();
  } catch {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, fallback, 'utf-8');
    return fallback;
  }
}

async function readLocalManifest(root: string): Promise<ResourceManifest | null> {
  try {
    const raw = await fs.readFile(path.join(root, 'manifest.json'), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return isValidManifest(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function isLocalFileValid(targetPath: string, entry: ResourceManifestEntry, trustedByManifest: boolean): Promise<boolean> {
  try {
    const stat = await fs.stat(targetPath);
    if (!stat.isFile() || stat.size !== entry.size) return false;
    if (trustedByManifest) return true;
    const buf = await fs.readFile(targetPath);
    return sha256Buffer(buf) === entry.sha256;
  } catch {
    return false;
  }
}

async function writeFileAtomic(targetPath: string, data: Buffer | string): Promise<void> {
  await fs.mkdir(path.dirname(targetPath), { recursive: true });
  const tmpPath = `${targetPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, data);
  await fs.rename(tmpPath, targetPath);
}

/**
 * 读取并校验 data/jellyfish.json，成功后同步到数据库并清理用户箱中已下线的水母 ID。
 */
export async function syncJellyfishDatabase(ctx: Context, resourceRoot: string): Promise<void> {
  const jsonPath = path.join(resourceRoot, 'data', 'jellyfish.json');
  const rawJson = await fs.readFile(jsonPath, 'utf-8');
  const meta = JSON.parse(rawJson) as { jellyfishes?: JellyfishMeta[]; events?: EventMeta[] };

  if (!Array.isArray(meta.jellyfishes) || !Array.isArray(meta.events)) {
    throw new Error('jellyfish.json 格式不正确，跳过本次数据库更新');
  }

  await ctx.database.remove('mzk_jellyfish_meta', {});
  await ctx.database.remove('mzk_jellyfish_event_meta', {});
  if (meta.jellyfishes.length > 0) {
    await ctx.database.upsert('mzk_jellyfish_meta', meta.jellyfishes);
  }
  if (meta.events.length > 0) {
    await ctx.database.upsert('mzk_jellyfish_event_meta', meta.events);
  }

  const validIds = new Set(meta.jellyfishes.map((j) => j.id));
  const boxes = await ctx.database.get('mzk_jellyfish_box', {});
  for (const box of boxes) {
    const filtered = box.jellyfish.filter((jelly) => validIds.has(jelly.id));
    if (filtered.length !== box.jellyfish.length) {
      await ctx.database.set('mzk_jellyfish_box', { user_id: box.user_id }, {
        jellyfish: filtered
      });
    }
  }
}

/**
 * 使用 manifest.json 进行 SHA-256 增量同步：仅下载新增或哈希变化的文件。
 */
async function syncWithManifest(
  ctx: Context,
  cdn: string,
  root: string,
  remoteManifest: ResourceManifest
): Promise<void> {
  const logger = ctx.logger('mizuki-bot-update');
  const localManifest = await readLocalManifest(root);
  const { toDelete } = diffManifests(remoteManifest, localManifest);

  // 逐文件校验本地是否存在且有效（兼容从旧协议平滑迁移到 manifest.json，避免重下 30MB 字体）
  const toDownload: string[] = [];
  for (const [relPath, entry] of Object.entries(remoteManifest.files)) {
    const targetPath = resolveSafePath(root, relPath);
    if (!targetPath) {
      logger.warn(`跳过不安全的资源路径：${relPath}`);
      continue;
    }
    const localEntry = localManifest?.files[relPath];
    const trusted = Boolean(localEntry && localEntry.sha256 === entry.sha256 && localEntry.size === entry.size);
    if (!(await isLocalFileValid(targetPath, entry, trusted))) {
      toDownload.push(relPath);
    }
  }

  const existingMetaCount = (await ctx.database.get('mzk_jellyfish_meta', {}, ['id'])).length;
  const localJsonHash = localManifest?.files['data/jellyfish.json']?.sha256;
  const remoteJsonHash = remoteManifest.files['data/jellyfish.json']?.sha256;
  const needDbSync = existingMetaCount === 0
    || toDownload.includes('data/jellyfish.json')
    || (Boolean(remoteJsonHash) && localJsonHash !== remoteJsonHash);

  if (toDownload.length === 0 && toDelete.length === 0 && !needDbSync && localManifest?.version === remoteManifest.version) {
    logger.info(`水母箱资源已是最新（版本 ${remoteManifest.version}，共 ${Object.keys(remoteManifest.files).length} 个文件）`);
    return;
  }

  if (toDownload.length > 0) {
    const totalBytes = toDownload.reduce((sum, rel) => sum + (remoteManifest.files[rel]?.size ?? 0), 0);
    logger.info(
      `增量下载水母箱资源：${toDownload.length}/${Object.keys(remoteManifest.files).length} 个文件（${(totalBytes / 1024).toFixed(1)} KB）`
    );

    await runWithConcurrency(toDownload, DOWNLOAD_CONCURRENCY, async (relPath, index) => {
      const targetPath = resolveSafePath(root, relPath)!;
      const expected = remoteManifest.files[relPath];
      const remoteUrl = `${cdn}/${encodeRelativeUrl(relPath)}`;
      const data = await ctx.http.get(remoteUrl, {
        responseType: 'arraybuffer',
        timeout: HTTP_TIMEOUT_MS
      });
      const buf = Buffer.from(data);
      const actualHash = sha256Buffer(buf);
      if (actualHash !== expected.sha256) {
        throw new Error(`文件校验失败 (${relPath})：期望 ${expected.sha256.slice(0, 12)}，实际 ${actualHash.slice(0, 12)}`);
      }
      await writeFileAtomic(targetPath, buf);
      logger.debug(`已增量下载 (${index + 1}/${toDownload.length}): ${relPath}`);
    });
  }

  if (needDbSync) {
    await syncJellyfishDatabase(ctx, root);
  }

  for (const relPath of toDelete) {
    const targetPath = resolveSafePath(root, relPath);
    if (!targetPath) continue;
    await fs.rm(targetPath, { force: true });
    logger.debug(`已清理过期本地资源: ${relPath}`);
  }

  if (toDownload.length > 0 || toDelete.length > 0) {
    assetCache.clear();
  }

  await writeFileAtomic(path.join(root, 'manifest.json'), JSON.stringify(remoteManifest, null, 2) + '\n');
  await writeFileAtomic(path.join(root, 'jelly_version.txt'), String(remoteManifest.version));
  logger.info(`水母箱资源同步完成（版本 ${remoteManifest.version}，下载 ${toDownload.length} 个，清理 ${toDelete.length} 个）`);
}

export async function jellyfishBoxCheck(ctx: Context, config: Config, root: string): Promise<void> {
  const logger = ctx.logger('mizuki-bot-update');

  // 本地调试模式：直接从本地资源目录同步数据库，不访问远程 CDN
  const localDir = config.localResourceDir?.trim();
  if (localDir) {
    const resolvedDir = path.resolve(ctx.baseDir, localDir);
    await syncJellyfishDatabase(ctx, resolvedDir);
    assetCache.clear();
    logger.info(`已从本地目录加载水母箱资源：${resolvedDir}`);
    return;
  }

  if (!ctx.http) return;

  const cdn = config.remote.replace(/\/+$/, '');

  // 优先走 manifest.json 增量同步协议
  try {
    const manifest = await ctx.http.get<unknown>(`${cdn}/manifest.json`, {
      responseType: 'json',
      headers: { 'Cache-Control': 'no-cache' },
      timeout: HTTP_TIMEOUT_MS
    });
    if (isValidManifest(manifest)) {
      if (isUpdatingJellyfish) {
        logger.info('水母箱资源正在同步中，跳过重复触发');
        return;
      }
      isUpdatingJellyfish = true;
      try {
        await syncWithManifest(ctx, cdn, root, manifest);
      } finally {
        isUpdatingJellyfish = false;
      }
      return;
    }
  } catch (err) {
    logger.debug(`未获取到 manifest.json，尝试回退旧版同步协议：${getErrorMessage(err)}`);
  }

  // 回退旧版 version.txt + list.txt 协议（兼容自定义旧镜像源）
  const localVersionFile = path.join(root, 'jelly_version.txt');
  const localVersion = await readLocalVersion(localVersionFile, '0');

  try {
    const remoteVersion = (await ctx.http.get(`${cdn}/version.txt`, {
      responseType: 'text',
      timeout: HTTP_TIMEOUT_MS
    })).trim();

    logger.info(`当前本地水母箱资源版本：${localVersion}，最新：${remoteVersion}`);
    if (Number(remoteVersion) > Number(localVersion)) {
      ctx.emit('mizuki/resource_update', remoteVersion);
    }
  } catch (err) {
    logger.error('读取水母箱资源版本失败', getErrorMessage(err));
  }
}

export async function jellyfishBoxUpdate(
  ctx: Context,
  config: Config,
  root: string,
  version: string
): Promise<void> {
  const logger = ctx.logger('mizuki-bot-update');
  if (isUpdatingJellyfish) {
    logger.info('水母箱资源正在更新中，跳过重复触发');
    return;
  }

  isUpdatingJellyfish = true;
  try {
    const cdn = config.remote.replace(/\/+$/, '');
    const localVersionFile = path.join(root, 'jelly_version.txt');
    const listText = await ctx.http.get(`${cdn}/list.txt`, {
      responseType: 'text',
      timeout: HTTP_TIMEOUT_MS
    });

    const files = listText
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    logger.info(`开始下载水母箱资源（旧协议），共 ${files.length} 个文件`);
    await runWithConcurrency(files, DOWNLOAD_CONCURRENCY, async (relativePath, index) => {
      const targetPath = resolveSafePath(root, relativePath);
      if (!targetPath) {
        logger.warn(`跳过不安全的资源路径：${relativePath}`);
        return;
      }
      const remoteUrl = `${cdn}/${encodeRelativeUrl(relativePath)}`;
      const data = await ctx.http.get(remoteUrl, {
        responseType: 'arraybuffer',
        timeout: HTTP_TIMEOUT_MS
      });
      await writeFileAtomic(targetPath, Buffer.from(data));
      logger.debug(`已下载 (${index + 1}/${files.length}): ${relativePath}`);
    });

    await syncJellyfishDatabase(ctx, root);
    assetCache.clear();
    await writeFileAtomic(localVersionFile, version.trim());
    logger.info(`水母箱资源与数据库已更新至版本 ${version.trim()}`);
  } finally {
    isUpdatingJellyfish = false;
  }
}

export async function arknightsDataCheck(ctx: Context, config: Config, root: string): Promise<void> {
  const logger = ctx.logger('mizuki-bot-update');
  const baseUrl = config.arknightsGameResource.replace(/\/+$/, '');
  const localVersionFile = path.join(root, 'arknights_version.txt');
  const localVersion = await readLocalVersion(localVersionFile, '00-00-00-00-00-00-abcdef');
  if (!ctx.http) return;

  try {
    const remoteVersion = (await ctx.http.get(`${baseUrl}/version`, {
      responseType: 'text',
      timeout: HTTP_TIMEOUT_MS
    })).trim();

    logger.info(`当前本地明日方舟资源版本：${localVersion}，最新：${remoteVersion}`);
    if (isNewerArknightsVersion(remoteVersion, localVersion)) {
      ctx.emit('mizuki/arknights_update', remoteVersion);
    }
  } catch (err) {
    logger.error('检查明日方舟资源版本失败', getErrorMessage(err));
  }
}

export async function arknightsDataUpdate(
  ctx: Context,
  config: Config,
  root: string,
  version: string
): Promise<void> {
  const logger = ctx.logger('mizuki-bot-update');
  if (isUpdatingArknights) {
    logger.info('明日方舟数据正在更新中，跳过重复触发');
    return;
  }

  isUpdatingArknights = true;
  try {
    const baseUrl = config.arknightsGameResource.replace(/\/+$/, '');
    const localVersionFile = path.join(root, 'arknights_version.txt');
    let succeeded = 0;
    let failed = 0;

    for (const relUrl of ARKNIGHTS_RES_URLS) {
      try {
        logger.info(`正在下载明日方舟数据 (${succeeded + failed + 1}/${ARKNIGHTS_RES_URLS.length}): ${relUrl}`);
        const data = await ctx.http.get(`${baseUrl}/${relUrl}`, {
          responseType: 'arraybuffer',
          timeout: HTTP_TIMEOUT_MS
        });
        const localPath = path.join(root, 'arknights', relUrl);
        await writeFileAtomic(localPath, Buffer.from(data));
        succeeded += 1;
      } catch (err) {
        failed += 1;
        logger.error(`下载明日方舟数据失败: ${relUrl}`, getErrorMessage(err));
      }
    }

    if (failed === 0) {
      clearArknightsDataCache();
      await writeFileAtomic(localVersionFile, version.trim());
      logger.info(`明日方舟数据已更新至版本 ${version.trim()}`);
    } else {
      logger.warn(`明日方舟数据更新不完整（成功 ${succeeded}/失败 ${failed}），保留原版本号待重试`);
    }
  } finally {
    isUpdatingArknights = false;
  }
}
