import * as fsSync from 'fs';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Context, Logger, Session } from 'koishi';
import type { Canvas, CanvasRenderingContext2D, Image } from '@ltxhhz/koishi-plugin-skia-canvas';
import { Config } from '../config';
import { DrawStyle, Jellyfish, JellyfishBox, JellyfishMeta } from '../database';
import { randomInt } from '../utils/random';
import { getOrCreateUser, resolveDisplayName, resolveSessionUserId } from '../utils/user';
import { getGroupPriority } from './constants';
import { JellyfishBoxEvent } from './service';

const logger = new Logger('mizuki-bot-renderer');

const BOX_CANVAS_WIDTH = 768;
const BOX_TANK_WIDTH = 672;
const BOX_TANK_HEIGHT = 416;
const CARD_WIDTH = 672;
const JELLY_CARD_HEIGHT = 162;
const HEADER_BOTTOM_Y = 608;
const MAX_PACMAN_DOTS = 13;

const formatDate = (d: Date): string =>
  `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
};

const drawRoundRect = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) => {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.closePath();
  ctx.clip();
  ctx.fillRect(x, y, width, height);
  ctx.restore();
};

const truncateText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string => {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '...';
  let result = '';
  for (const ch of text) {
    if (ctx.measureText(result + ch + ellipsis).width > maxWidth) break;
    result += ch;
  }
  return result + ellipsis;
};

const wrapText = (
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
  maxLines?: number
): string[] => {
  if (!text) return [''];
  const lines: string[] = [];
  let current = '';

  for (const ch of text) {
    if (ch === '\n') {
      lines.push(current);
      current = '';
      if (maxLines && lines.length >= maxLines) break;
      continue;
    }
    const candidate = current + ch;
    if (ctx.measureText(candidate).width > maxWidth && current.length > 0) {
      if (maxLines && lines.length + 1 >= maxLines) {
        lines.push(truncateText(ctx, current + ch, maxWidth));
        return lines;
      }
      lines.push(current);
      current = ch;
    } else {
      current = candidate;
    }
  }

  if (current.length > 0 && (!maxLines || lines.length < maxLines)) {
    lines.push(current);
  }

  return lines.length > 0 ? lines : [''];
};

interface CachedSprite {
  canvas: Canvas;
  isPixel: boolean;
}

class JellyfishAssetCache {
  private registeredFontRoots = new Set<string>();
  private themeImages = new Map<string, Image>();
  private sprites = new Map<string, CachedSprite>();

  ensureFonts(ctx: Context, fontRoot: string) {
    if (this.registeredFontRoots.has(fontRoot)) return;
    const { FontLibrary } = ctx.skia;
    const fonts: ReadonlyArray<readonly [string, string, boolean]> = [
      ['noto-sans-sc-regular', 'NotoSansSC-Regular.ttf', true],
      ['noto-sans-sc-medium', 'NotoSansSC-Medium.ttf', true],
      ['noto-sans-sc-bold', 'NotoSansSC-Bold.ttf', true],
      ['unifont', 'unifont-16.0.02.otf', false],
      ['fusion-pixel-12px', 'fusion-pixel-12px-proportional-zh_hans.otf', false]
    ];
    for (const [family, fileName, required] of fonts) {
      const fontPath = path.join(fontRoot, fileName);
      if (required || fsSync.existsSync(fontPath)) {
        FontLibrary.use(family, fontPath);
      }
    }
    this.registeredFontRoots.add(fontRoot);
  }

  async getThemeImage(ctx: Context, imagePath: string): Promise<Image> {
    const cached = this.themeImages.get(imagePath);
    if (cached) return cached;
    const image = await ctx.skia.loadImage(imagePath);
    this.themeImages.set(imagePath, image);
    return image;
  }

  async getProcessedSprite(
    ctx: Context,
    imageRoot: string,
    id: string,
    style: DrawStyle = 'normal'
  ): Promise<CachedSprite> {
    const cacheKey = `${imageRoot}:${style}:${id}`;
    const cached = this.sprites.get(cacheKey);
    if (cached) return cached;

    const defaultPath = path.join(imageRoot, 'jellyfish', 'default', `${id}.png`);
    const pixelPath = path.join(imageRoot, 'jellyfish', 'pixel', `${id}.png`);
    const usePixel = style === 'pixel' && await fileExists(pixelPath);
    const targetPath = usePixel ? pixelPath : defaultPath;

    const canvas = await cropJellyfishImage(ctx, targetPath);
    const entry: CachedSprite = { canvas, isPixel: usePixel };
    this.sprites.set(cacheKey, entry);
    return entry;
  }

  clear() {
    this.registeredFontRoots.clear();
    this.themeImages.clear();
    this.sprites.clear();
  }
}

export const assetCache = new JellyfishAssetCache();

async function cropJellyfishImage(ctx: Context, imagePath: string): Promise<Canvas> {
  const { Canvas, loadImage } = ctx.skia;
  const image = await loadImage(imagePath);

  const canvas = new Canvas(image.width, image.height);
  const skiaCtx = canvas.getContext('2d');
  skiaCtx.imageSmoothingQuality = 'high';
  skiaCtx.drawImage(image, 0, 0);

  const { width, height, data } = skiaCtx.getImageData(0, 0, canvas.width, canvas.height);
  let top = height;
  let bottom = -1;
  let left = width;
  let right = -1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3];
      if (alpha > 0) {
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  // 若整图完全透明则直接返回原画布，避免负宽高报错
  if (right < left || bottom < top) {
    return canvas;
  }

  let cropWidth = right - left + 1;
  let cropHeight = bottom - top + 1;
  if (cropWidth % 2 !== 0) cropWidth += 1;
  if (cropHeight % 2 !== 0) cropHeight += 1;
  cropWidth = Math.min(cropWidth, width - left);
  cropHeight = Math.min(cropHeight, height - top);

  const size = Math.max(cropWidth, cropHeight);
  const dx = Math.floor((size - cropWidth) / 2);
  const dy = Math.floor((size - cropHeight) / 2);

  const cropCanvas = new Canvas(size, size);
  const cropCtx = cropCanvas.getContext('2d');
  cropCtx.imageSmoothingQuality = 'high';
  cropCtx.drawImage(image, left, top, cropWidth, cropHeight, dx, dy, cropWidth, cropHeight);
  return cropCanvas;
}

async function loadUserAvatar(ctx: Context, avatarUrl: string | undefined, fallbackPath: string): Promise<Image> {
  if (avatarUrl) {
    try {
      if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
        const buffer = await ctx.http.get(avatarUrl, {
          responseType: 'arraybuffer',
          timeout: 5000
        });
        return await ctx.skia.loadImage(Buffer.from(buffer));
      }
      return await ctx.skia.loadImage(avatarUrl);
    } catch (error) {
      logger.warn('加载用户头像失败，回退默认头像', error instanceof Error ? error.message : String(error));
    }
  }
  return assetCache.getThemeImage(ctx, fallbackPath);
}

function drawTiledBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  backgroundColor: string,
  tileImage: Image
) {
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(0, 0, width, height);

  for (let y = 0; y < height; y += tileImage.height) {
    for (let x = 0; x < width; x += tileImage.width) {
      ctx.drawImage(tileImage, x, y, tileImage.width, tileImage.height);
    }
  }
}

function drawPacmanCanvas(koishiCtx: Context, dotCount: number): Canvas {
  const { Canvas } = koishiCtx.skia;
  const clampedDots = Math.min(MAX_PACMAN_DOTS, Math.max(0, dotCount));
  const canvas = new Canvas(240, 24);
  const ctx = canvas.getContext('2d');

  const centerX = 12;
  const centerY = 12;
  const radius = 12;

  ctx.fillStyle = '#e0e97d';
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.arc(centerX, centerY, radius, 0.2 * Math.PI, 1.8 * Math.PI, false);
  ctx.closePath();
  ctx.fill();

  ctx.globalCompositeOperation = 'destination-out';
  ctx.beginPath();
  ctx.arc(centerX + 2, centerY - 7, 1.5, 0, 2 * Math.PI, false);
  ctx.fill();
  ctx.globalCompositeOperation = 'source-over';

  ctx.fillStyle = '#8aabfd';
  for (let i = 1; i <= clampedDots; i++) {
    ctx.beginPath();
    ctx.arc(centerX + radius + i * 15, centerY, 6, 0, 2 * Math.PI, false);
    ctx.fill();
  }

  return canvas;
}

function drawCardWrapper(
  koishiCtx: Context,
  config: Config,
  width: number,
  height: number,
  title: string,
  content: Canvas
): Canvas {
  const { Canvas } = koishiCtx.skia;
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = config.theme.cardBackground;
  drawRoundRect(ctx, 0, 0, width, height, 16);

  ctx.fillStyle = config.theme.title;
  ctx.font = '30px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText(title, 24, 38);

  ctx.drawCanvas(content, 0, 38);
  return canvas;
}

async function drawJellyfishCardContent(params: {
  koishiCtx: Context;
  config: Config;
  jelly: Jellyfish;
  meta: JellyfishMeta;
  imageRoot: string;
  style?: DrawStyle;
  withBackground?: boolean;
  showNumber?: boolean;
}): Promise<Canvas> {
  const {
    koishiCtx,
    config,
    jelly,
    meta,
    imageRoot,
    style = 'normal',
    withBackground = false,
    showNumber = true
  } = params;
  const { Canvas } = koishiCtx.skia;
  const contentCanvas = new Canvas(CARD_WIDTH, JELLY_CARD_HEIGHT);
  const ctx = contentCanvas.getContext('2d');

  if (withBackground) {
    ctx.fillStyle = config.theme.cardBackground;
    drawRoundRect(ctx, 0, 0, CARD_WIDTH, JELLY_CARD_HEIGHT, 16);
  }

  const sprite = await assetCache.getProcessedSprite(koishiCtx, imageRoot, jelly.id, style);

  // 图标框
  const iconCanvas = new Canvas(128, 128);
  const iconCtx = iconCanvas.getContext('2d');
  iconCtx.fillStyle = config.theme.jellyIconBorder;
  drawRoundRect(iconCtx, 0, 0, 128, 128, 8);
  iconCtx.fillStyle = config.theme.jellyIconBackground;
  drawRoundRect(iconCtx, 4, 4, 120, 120, 4);
  iconCtx.imageSmoothingEnabled = !sprite.isPixel;
  iconCtx.drawCanvas(sprite.canvas, 0, 0, sprite.canvas.width, sprite.canvas.height, 12, 12, 104, 104);
  ctx.drawCanvas(iconCanvas, 24, 16);

  // 右下角半透明水印
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, CARD_WIDTH, JELLY_CARD_HEIGHT, 16);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 0.3;
  ctx.translate(CARD_WIDTH - 100, JELLY_CARD_HEIGHT / 2);
  ctx.rotate(-Math.PI / 4);
  ctx.imageSmoothingEnabled = !sprite.isPixel;
  ctx.drawCanvas(sprite.canvas, 0, 0, sprite.canvas.width, sprite.canvas.height, -100, -60, 220, 220);
  ctx.restore();

  const textX = 24 + 128 + 16;
  const maxTextWidth = CARD_WIDTH - textX - 24;

  // 水母名称
  ctx.fillStyle = config.theme.jellyName;
  ctx.font = '30px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText(truncateText(ctx, meta.name, maxTextWidth), textX, 46);

  // 水母描述（最多 2 行）
  ctx.fillStyle = config.theme.eventDescription;
  ctx.font = '22px noto-sans-sc-regular';
  const descLines = wrapText(ctx, meta.description, maxTextWidth, 2);
  const lineHeight = 26;
  descLines.forEach((line, index) => {
    ctx.fillText(line, textX, 76 + index * lineHeight);
  });

  // 数量 + 稀有度标签
  const metaY = 76 + descLines.length * lineHeight;
  ctx.fillStyle = showNumber ? config.theme.jellyName : config.theme.eventDescription;
  ctx.font = '24px noto-sans-sc-medium';
  const countLabel = showNumber ? `×${jelly.number}` : '稀有度：';
  ctx.fillText(countLabel, textX, metaY);

  const groupColor = config.theme.groups[meta.group as keyof typeof config.theme.groups] ?? config.theme.eventDescription;
  ctx.fillStyle = groupColor;
  const groupX = textX + ctx.measureText(countLabel).width + 8;
  ctx.fillText(meta.group.toUpperCase(), groupX, metaY);

  return contentCanvas;
}

function drawEventListCard(
  koishiCtx: Context,
  config: Config,
  title: string,
  events?: readonly JellyfishBoxEvent[]
): Canvas | null {
  if (!events || events.length === 0) return null;

  const { Canvas } = koishiCtx.skia;
  const maxTextWidth = CARD_WIDTH - 48;

  // 预测量每个事件的折行高度，避免长文本溢出卡片
  const measureCanvas = new Canvas(1, 1);
  const measureCtx = measureCanvas.getContext('2d');
  measureCtx.font = '22px noto-sans-sc-regular';

  const layout = events.map((event) => ({
    name: event.name,
    descLines: wrapText(measureCtx, event.description, maxTextWidth, 3)
  }));

  let totalHeight = 56;
  for (const entry of layout) {
    totalHeight += 32 + entry.descLines.length * 26 + 12;
  }
  totalHeight += 8;

  const canvas = new Canvas(CARD_WIDTH, totalHeight);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = config.theme.cardBackground;
  drawRoundRect(ctx, 0, 0, CARD_WIDTH, totalHeight, 16);

  ctx.fillStyle = config.theme.title;
  ctx.font = '30px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText(title, 24, 38);

  let y = 76;
  for (const entry of layout) {
    ctx.fillStyle = config.theme.eventTitle;
    ctx.font = '28px noto-sans-sc-medium';
    ctx.fillText(truncateText(ctx, entry.name, maxTextWidth), 24, y);
    y += 28;

    ctx.fillStyle = config.theme.eventDescription;
    ctx.font = '22px noto-sans-sc-regular';
    for (const line of entry.descLines) {
      ctx.fillText(line, 24, y);
      y += 26;
    }
    y += 16;
  }

  return canvas;
}

async function resolveSessionDisplayName(
  ctx: Context,
  session: Session,
  jellyfishBox?: JellyfishBox
): Promise<string> {
  if (jellyfishBox) {
    const users = await ctx.database.get('mzk_user', jellyfishBox.user_id);
    return resolveDisplayName(users[0], session);
  }
  const uid = resolveSessionUserId(session);
  if (!uid) return resolveDisplayName(undefined, session);
  const user = await getOrCreateUser(ctx, uid, session.platform);
  return resolveDisplayName(user, session);
}

function resolveJellyfishResourceRoot(ctx: Context, config: Config): string {
  const localDir = config.localResourceDir?.trim();
  if (localDir) {
    return path.resolve(ctx.baseDir, localDir);
  }
  return path.join(ctx.baseDir, 'data', 'mizuki-bot');
}

export async function renderJellyfishBox(params: {
  ctx: Context;
  config: Config;
  session: Session;
  jellyfishBox: JellyfishBox;
  allMeta: readonly JellyfishMeta[];
  newJelly?: Jellyfish;
  events?: readonly JellyfishBoxEvent[];
  isCatch?: boolean;
}): Promise<Buffer> {
  const { ctx: koishiCtx, config, session, jellyfishBox, allMeta, newJelly, events, isCatch = false } = params;
  const { Canvas } = koishiCtx.skia;

  const root = resolveJellyfishResourceRoot(koishiCtx, config);
  const imageRoot = path.join(root, 'image');
  const fontRoot = path.join(root, 'font');
  const themeRoot = path.join(imageRoot, 'theme', 'default');

  assetCache.ensureFonts(koishiCtx, fontRoot);

  const metaMap = new Map(allMeta.map((m) => [m.id, m]));
  const style: DrawStyle = jellyfishBox.draw_style === 'pixel' ? 'pixel' : 'normal';

  const helpItems: JellyfishBoxEvent[] = [
    { id: 'help1', name: '水母箱 -h', description: '查看水母箱全部指令介绍' },
    ...(!isCatch
      ? [{ id: 'help2', name: '抓水母', description: '抓几只新的水母放进水母箱' }]
      : [])
  ];

  let newJellyCard: Canvas | null = null;
  if (newJelly) {
    const newMeta = metaMap.get(newJelly.id);
    if (newMeta) {
      const content = await drawJellyfishCardContent({
        koishiCtx,
        config,
        jelly: newJelly,
        meta: newMeta,
        imageRoot,
        style
      });
      newJellyCard = drawCardWrapper(koishiCtx, config, CARD_WIDTH, 200, '新增', content);
    }
  }

  const eventsCard = drawEventListCard(koishiCtx, config, '事件列表', events);
  const helpCard = drawEventListCard(koishiCtx, config, '指令帮助', helpItems);

  const totalHeight = HEADER_BOTTOM_Y
    + (newJellyCard ? newJellyCard.height + 16 : 0)
    + (eventsCard ? eventsCard.height + 16 : 0)
    + (helpCard ? helpCard.height + 16 : 0)
    + 16;

  const canvas = new Canvas(BOX_CANVAS_WIDTH, totalHeight);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  // 背景与顶部装饰
  const [backgroundJelly, trDeco, avatarImage, username] = await Promise.all([
    assetCache.getThemeImage(koishiCtx, path.join(themeRoot, 'background_jelly.png')),
    assetCache.getThemeImage(koishiCtx, path.join(themeRoot, 'tr_deco.png')),
    loadUserAvatar(koishiCtx, session.event.user?.avatar, path.join(themeRoot, 'default_avatar.png')),
    resolveSessionDisplayName(koishiCtx, session, jellyfishBox)
  ]);

  drawTiledBackground(ctx, BOX_CANVAS_WIDTH, totalHeight, config.theme.backgroundColor, backgroundJelly);
  ctx.drawImage(trDeco, BOX_CANVAS_WIDTH - trDeco.width, 0);

  // 圆形头像
  const avatarSize = 96;
  const avatarCanvas = new Canvas(avatarSize, avatarSize);
  const avatarCtx = avatarCanvas.getContext('2d');
  avatarCtx.imageSmoothingQuality = 'high';
  const avatarRadius = avatarSize / 2;
  avatarCtx.beginPath();
  avatarCtx.arc(avatarRadius, avatarRadius, avatarRadius, 0, Math.PI * 2);
  avatarCtx.closePath();
  avatarCtx.clip();
  avatarCtx.drawImage(avatarImage, 0, 0, avatarSize, avatarSize);
  ctx.drawCanvas(avatarCanvas, 80, 64);

  // 用户名（超长自动截断）
  const nameX = 80 + avatarSize + 24;
  const maxNameWidth = BOX_CANVAS_WIDTH - nameX - 48;
  ctx.font = '48px noto-sans-sc-bold';
  ctx.fillStyle = config.theme.name;
  ctx.textAlign = 'left';
  const displayUsername = truncateText(ctx, username, maxNameWidth);
  const nameMetrics = ctx.measureText(displayUsername);
  ctx.fillText(displayUsername, nameX, 64 + nameMetrics.actualBoundingBoxAscent);

  // 吃豆人进度条
  const jellyCount = jellyfishBox.jellyfish.reduce((sum, jelly) => sum + jelly.number, 0);
  const pacmanCanvas = drawPacmanCanvas(koishiCtx, Math.floor(jellyCount / 20));
  ctx.drawImage(pacmanCanvas, nameX, 64 + nameMetrics.actualBoundingBoxAscent + 8);

  // 日期与水箱环境温盐度
  ctx.fillStyle = '#7986cb';
  ctx.font = '24px noto-sans-sc-medium';
  ctx.textAlign = 'right';
  const temp = Math.round(jellyfishBox.temperature ?? 25);
  const salinity = Math.round(jellyfishBox.salinity ?? 25);
  const dateText = `${temp}°C · ${salinity}‰  〇 ${formatDate(new Date())}`;
  const dateMetrics = ctx.measureText(dateText);
  ctx.fillText(dateText, 688, 150 + dateMetrics.actualBoundingBoxAscent);

  // 水母箱外框与内容画布
  ctx.fillStyle = config.theme.boxOutline;
  drawRoundRect(ctx, 48, 192, BOX_TANK_WIDTH, BOX_TANK_HEIGHT, 12);

  const boxCanvas = new Canvas(BOX_TANK_WIDTH, BOX_TANK_HEIGHT);
  const boxCtx = boxCanvas.getContext('2d');
  boxCtx.imageSmoothingQuality = 'high';
  boxCtx.fillStyle = config.theme.boxBackground;
  drawRoundRect(boxCtx, 4, 4, BOX_TANK_WIDTH - 8, BOX_TANK_HEIGHT - 8, 8);

  // 绘制箱内水母
  for (const jelly of jellyfishBox.jellyfish) {
    if (jelly.number <= 0) continue;
    try {
      const sprite = await assetCache.getProcessedSprite(koishiCtx, imageRoot, jelly.id, style);
      const jellyMeta = metaMap.get(jelly.id);
      const targetSize = jellyMeta?.draw?.size || 32;
      const w = sprite.canvas.width;
      const h = sprite.canvas.height;
      const ratio = targetSize / Math.max(w, h);
      const drawW = w * ratio;
      const drawH = h * ratio;
      const pad = Math.ceil(Math.hypot(drawW, drawH) / 2) + 8;
      const minX = Math.min(pad, BOX_TANK_WIDTH / 2);
      const maxX = Math.max(minX, BOX_TANK_WIDTH - pad);
      const minY = Math.min(pad, BOX_TANK_HEIGHT / 2);
      const maxY = Math.max(minY, BOX_TANK_HEIGHT - pad);

      for (let j = 0; j < jelly.number; j++) {
        const x = randomInt(minX, maxX);
        const y = randomInt(minY, maxY);
        const angle = randomInt(-180, 180) * (Math.PI / 180);
        boxCtx.save();
        boxCtx.imageSmoothingEnabled = !sprite.isPixel;
        boxCtx.translate(x, y);
        boxCtx.rotate(angle);
        boxCtx.drawCanvas(sprite.canvas, -drawW / 2, -drawH / 2, drawW, drawH);
        boxCtx.restore();
      }
    } catch (error) {
      logger.error(`绘制水母 ${jelly.id} 失败`, error instanceof Error ? error.message : String(error));
    }
  }

  ctx.drawCanvas(boxCanvas, 48, 192);

  // 底部卡片区
  let currentY = HEADER_BOTTOM_Y + 16;
  for (const card of [newJellyCard, eventsCard, helpCard]) {
    if (!card) continue;
    ctx.drawCanvas(card, 48, currentY);
    currentY += card.height + 16;
  }

  return canvas.toBuffer('png');
}

export async function renderJellyfishStatistics(params: {
  ctx: Context;
  config: Config;
  session: Session;
  allMeta: readonly JellyfishMeta[];
  jellyfishBox?: JellyfishBox;
}): Promise<Buffer> {
  const { ctx: koishiCtx, config, session, allMeta, jellyfishBox } = params;
  const { Canvas } = koishiCtx.skia;

  const isStatistics = Boolean(jellyfishBox);
  const metaMap = new Map(allMeta.map((m) => [m.id, m]));
  const style: DrawStyle = jellyfishBox?.draw_style === 'pixel' ? 'pixel' : 'normal';

  const jellies: Jellyfish[] = jellyfishBox
    ? jellyfishBox.jellyfish.filter((j) => j.number > 0 && metaMap.has(j.id)).map((j) => ({ ...j }))
    : allMeta.map((m) => ({ id: m.id, number: 0 }));

  jellies.sort((a, b) => {
    const priorityDiff = getGroupPriority(metaMap.get(b.id)?.group) - getGroupPriority(metaMap.get(a.id)?.group);
    if (priorityDiff !== 0) return priorityDiff;
    return b.number - a.number;
  });

  const speciesCount = jellies.length;
  const cols = Math.max(1, Math.ceil(speciesCount / 10));
  const rows = Math.max(1, Math.min(10, speciesCount));
  const width = 24 + cols * (CARD_WIDTH + 24);
  const height = 84 + 24 + 24 + rows * (JELLY_CARD_HEIGHT + 8);

  const root = resolveJellyfishResourceRoot(koishiCtx, config);
  const imageRoot = path.join(root, 'image');
  const fontRoot = path.join(root, 'font');
  const themeRoot = path.join(imageRoot, 'theme', 'default');

  assetCache.ensureFonts(koishiCtx, fontRoot);

  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  const backgroundImage = await assetCache.getThemeImage(koishiCtx, path.join(themeRoot, 'background_jelly.png'));
  drawTiledBackground(ctx, width, height, config.theme.backgroundColor, backgroundImage);

  // 日期
  ctx.fillStyle = config.theme.date;
  ctx.font = '24px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText('〇 ' + formatDate(new Date()), 48, 54);

  // 标题
  let titleText = '水母图鉴';
  if (isStatistics && jellyfishBox) {
    const username = await resolveSessionDisplayName(koishiCtx, session, jellyfishBox);
    const totalCount = jellies.reduce((sum, j) => sum + j.number, 0);
    titleText = `水母统计表@${username}（共${totalCount}只）`;
  }

  ctx.fillStyle = config.theme.title;
  ctx.font = '32px noto-sans-sc-bold';
  ctx.fillText(truncateText(ctx, titleText, width - 96), 48, 86);

  // 绘制每张水母卡片
  for (let i = 0; i < jellies.length; i++) {
    const row = i % 10;
    const col = Math.floor(i / 10);
    const jelly = jellies[i];
    const meta = metaMap.get(jelly.id);
    if (!meta) continue;

    try {
      const card = await drawJellyfishCardContent({
        koishiCtx,
        config,
        jelly,
        meta,
        imageRoot,
        style,
        withBackground: true,
        showNumber: isStatistics
      });
      const dx = 24 + col * (CARD_WIDTH + 24);
      const dy = 84 + 24 + row * (JELLY_CARD_HEIGHT + 8);
      ctx.drawCanvas(card, dx, dy);
    } catch (error) {
      logger.error(`绘制水母卡片 ${jelly.id} 失败`, error instanceof Error ? error.message : String(error));
    }
  }

  return canvas.toBuffer('png');
}
