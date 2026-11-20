import * as path from 'path';
import { Context } from 'koishi';
import type { CanvasRenderingContext2D } from '@ltxhhz/koishi-plugin-skia-canvas';
import {
  AK_PALETTE,
  drawArknightsBackground,
  drawBarcode,
  drawChamferBox,
  drawCornerBrackets,
  drawHazardStripes,
  drawRhodesDiamond,
  fitText
} from '../arknights/ui_primitives';
import { Config } from '../config';
import { assetCache } from '../jellyfish/renderer';
import { ChangelogData } from './types';

const CARD_WIDTH = 780;
const PAD_X = 36;
const INNER_W = CARD_WIDTH - PAD_X * 2;
const TOP_BAR_H = 42;
const SECTION_GAP = 16;

interface TagStyle {
  accent: string;
  bg: string;
  text: string;
}

const TAG_STYLES: Record<string, TagStyle> = {
  NEW: { accent: AK_PALETTE.cyan, bg: 'rgba(34, 187, 255, 0.16)', text: '#6bd4ff' },
  FEAT: { accent: AK_PALETTE.cyan, bg: 'rgba(34, 187, 255, 0.16)', text: '#6bd4ff' },
  新增: { accent: AK_PALETTE.cyan, bg: 'rgba(34, 187, 255, 0.16)', text: '#6bd4ff' },
  UPDATE: { accent: AK_PALETTE.yellow, bg: 'rgba(245, 197, 24, 0.16)', text: '#ffd84d' },
  IMPROVE: { accent: AK_PALETTE.yellow, bg: 'rgba(245, 197, 24, 0.16)', text: '#ffd84d' },
  CHANGE: { accent: AK_PALETTE.yellow, bg: 'rgba(245, 197, 24, 0.16)', text: '#ffd84d' },
  优化: { accent: AK_PALETTE.yellow, bg: 'rgba(245, 197, 24, 0.16)', text: '#ffd84d' },
  调整: { accent: AK_PALETTE.yellow, bg: 'rgba(245, 197, 24, 0.16)', text: '#ffd84d' },
  FIX: { accent: AK_PALETTE.greenBright, bg: 'rgba(54, 211, 139, 0.16)', text: '#5ee8a8' },
  BUGFIX: { accent: AK_PALETTE.greenBright, bg: 'rgba(54, 211, 139, 0.16)', text: '#5ee8a8' },
  修复: { accent: AK_PALETTE.greenBright, bg: 'rgba(54, 211, 139, 0.16)', text: '#5ee8a8' },
  NOTICE: { accent: AK_PALETTE.redBright, bg: 'rgba(255, 92, 92, 0.16)', text: '#ff8080' },
  WARN: { accent: AK_PALETTE.redBright, bg: 'rgba(255, 92, 92, 0.16)', text: '#ff8080' },
  BREAKING: { accent: AK_PALETTE.redBright, bg: 'rgba(255, 92, 92, 0.16)', text: '#ff8080' },
  注意: { accent: AK_PALETTE.redBright, bg: 'rgba(255, 92, 92, 0.16)', text: '#ff8080' },
  重要: { accent: AK_PALETTE.redBright, bg: 'rgba(255, 92, 92, 0.16)', text: '#ff8080' }
};

const DEFAULT_TAG_STYLE: TagStyle = {
  accent: '#7ec8e3',
  bg: 'rgba(126, 200, 227, 0.16)',
  text: '#a4d9ed'
};

function resolveTagStyle(tag: string): TagStyle {
  return TAG_STYLES[tag.trim().toUpperCase()] ?? TAG_STYLES[tag.trim()] ?? DEFAULT_TAG_STYLE;
}

function resolveResourceRoot(ctx: Context, config: Config): string {
  const localDir = config.localResourceDir?.trim();
  return localDir ? path.resolve(ctx.baseDir, localDir) : path.join(ctx.baseDir, 'data', 'mizuki-bot');
}

function wrapParagraph(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 12): string[] {
  const paragraphs = text.split(/\r?\n/);
  const lines: string[] = [];

  for (const para of paragraphs) {
    if (!para) {
      if (lines.length < maxLines) lines.push('');
      continue;
    }
    let current = '';
    for (const ch of para) {
      if (ctx.measureText(current + ch).width > maxWidth && current) {
        if (lines.length + 1 >= maxLines) {
          lines.push(fitText(ctx, current + ch, maxWidth));
          return lines;
        }
        lines.push(current);
        current = ch;
      } else {
        current += ch;
      }
    }
    if (current) {
      if (lines.length >= maxLines) return lines;
      lines.push(current);
    }
  }
  return lines;
}

function drawMiniDiamond(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.lineTo(cx + r, cy);
  ctx.lineTo(cx, cy + r);
  ctx.lineTo(cx - r, cy);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

interface MeasuredSection {
  tag: string;
  title: string;
  style: TagStyle;
  wrappedItems: string[][];
  panelHeight: number;
}

/**
 * 将 ChangelogData 渲染为明日方舟 PRTS 风格的更新公告卡片 PNG Buffer。
 */
export async function renderChangelogCard(
  koishiCtx: Context,
  config: Config,
  changelog: ChangelogData
): Promise<Buffer> {
  const { Canvas } = koishiCtx.skia;
  const root = resolveResourceRoot(koishiCtx, config);
  const fontRoot = path.join(root, 'font');

  try {
    assetCache.ensureFonts(koishiCtx, fontRoot);
  } catch {
    // 字体尚未下载时允许回退系统字体
  }

  // 第一遍：精确测算各模块换行与动态画布高度
  const measureCanvas = new Canvas(16, 16);
  const mctx = measureCanvas.getContext('2d');

  const heroTitleMaxW = INNER_W - 160;
  const summaryMaxW = INNER_W - 48;
  mctx.font = '15px noto-sans-sc-medium';
  const summaryLines = changelog.summary
    ? wrapParagraph(mctx, changelog.summary, summaryMaxW, 4)
    : [];

  const heroBaseH = 98;
  const summaryLineH = 24;
  const heroH = summaryLines.length > 0
    ? heroBaseH + 14 + summaryLines.length * summaryLineH + 16
    : heroBaseH + 14;

  const itemMaxW = INNER_W - 60;
  const itemLineH = 25;
  const itemGap = 11;
  const sectionHeaderH = 48;
  const sectionPadBottom = 18;
  const sectionPadTopAfterDivider = 15;

  mctx.font = '15px noto-sans-sc-medium';
  const measuredSections: MeasuredSection[] = changelog.sections.map((section) => {
    const style = resolveTagStyle(section.tag);
    const wrappedItems = section.items.map((item) => wrapParagraph(mctx, item, itemMaxW, 8));
    const itemsHeight = wrappedItems.reduce((sum, lines, idx) => {
      return sum + lines.length * itemLineH + (idx > 0 ? itemGap : 0);
    }, 0);
    const panelHeight = sectionHeaderH + sectionPadTopAfterDivider + itemsHeight + sectionPadBottom;
    return {
      tag: section.tag,
      title: section.title,
      style,
      wrappedItems,
      panelHeight
    };
  });

  const footerText = changelog.footer || 'MIZUKI TERMINAL // 发送「帮助」查看全部指令';
  mctx.font = '14px noto-sans-sc-medium';
  const footerLines = wrapParagraph(mctx, footerText, INNER_W - 220, 2);
  const footerH = Math.max(46, 20 + footerLines.length * 20);

  const heroY = TOP_BAR_H + 22;
  let sectionsTotalH = 0;
  for (let i = 0; i < measuredSections.length; i++) {
    sectionsTotalH += measuredSections[i].panelHeight + (i > 0 ? SECTION_GAP : 0);
  }
  const sectionsStartY = heroY + heroH + 20;
  const footerY = sectionsStartY + sectionsTotalH + 22;
  const totalHeight = footerY + footerH + 20;

  // 第二遍：正式绘制 PRTS 战术公告卡片
  const canvas = new Canvas(CARD_WIDTH, totalHeight);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  drawArknightsBackground(ctx, CARD_WIDTH, totalHeight, 'DISPATCH');

  // ── 顶部 PRTS 状态栏 ───────────────────────────────────────────
  ctx.fillStyle = '#0d0f12';
  ctx.fillRect(0, 0, CARD_WIDTH, TOP_BAR_H);
  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.fillRect(0, 0, CARD_WIDTH, 3);
  ctx.fillStyle = AK_PALETTE.hairline;
  ctx.fillRect(0, TOP_BAR_H - 1, CARD_WIDTH, 1);

  // 状态指示块
  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.fillRect(PAD_X, 15, 8, 12);
  ctx.fillStyle = AK_PALETTE.yellow;
  ctx.fillRect(PAD_X + 11, 15, 3, 12);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = AK_PALETTE.textSecondary;
  ctx.font = '13px noto-sans-sc-bold';
  ctx.fillText('PRTS // MIZUKI TERMINAL UPDATE LOG', PAD_X + 22, 22);

  const versionTag = changelog.version.startsWith('v') || changelog.version.startsWith('V')
    ? changelog.version
    : `v${changelog.version}`;
  ctx.textAlign = 'right';
  ctx.fillStyle = AK_PALETTE.textMuted;
  ctx.font = '13px noto-sans-sc-medium';
  ctx.fillText(`BUILD ${versionTag}  ·  ${changelog.date}`, CARD_WIDTH - PAD_X, 22);

  // ── Hero 标题主模块 ────────────────────────────────────────────
  drawChamferBox(
    ctx,
    PAD_X,
    heroY,
    INNER_W,
    heroH,
    { tl: 0, tr: 18, br: 0, bl: 14 },
    AK_PALETTE.panel,
    AK_PALETTE.panelBorder,
    1.2
  );
  // 左侧双色工业主色条
  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.fillRect(PAD_X, heroY, 5, heroH - 14);
  ctx.fillStyle = AK_PALETTE.yellow;
  ctx.fillRect(PAD_X, heroY, 5, 26);

  // 右上角细斜条警戒纹理
  drawHazardStripes(ctx, PAD_X + INNER_W - 134, heroY + 1, 114, 14, 'rgba(34, 187, 255, 0.22)', 10, 3);
  drawCornerBrackets(ctx, PAD_X + 10, heroY + 10, INNER_W - 20, heroH - 20, 8, 'rgba(255, 255, 255, 0.14)', 1);

  // 右侧装饰菱形徽标 + 版本号区块
  const badgeBoxW = 112;
  const badgeBoxH = 66;
  const badgeBoxX = PAD_X + INNER_W - badgeBoxW - 20;
  const badgeBoxY = heroY + 26;
  drawChamferBox(
    ctx,
    badgeBoxX,
    badgeBoxY,
    badgeBoxW,
    badgeBoxH,
    { tl: 8, tr: 0, br: 8, bl: 0 },
    AK_PALETTE.panelAlt,
    'rgba(34, 187, 255, 0.45)',
    1
  );
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = AK_PALETTE.textMuted;
  ctx.font = '11px noto-sans-sc-bold';
  ctx.fillText('VERSION', badgeBoxX + badgeBoxW / 2, badgeBoxY + 18);
  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.font = '21px noto-sans-sc-bold';
  ctx.fillText(fitText(ctx, versionTag, badgeBoxW - 14), badgeBoxX + badgeBoxW / 2, badgeBoxY + 44);

  // 左侧眉标 + 主标题
  const heroTextX = PAD_X + 24;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.font = '13px noto-sans-sc-bold';
  ctx.fillText(
    fitText(ctx, (changelog.subtitle || 'PRTS // SYSTEM UPDATE DISPATCH').toUpperCase(), heroTitleMaxW),
    heroTextX,
    heroY + 30
  );

  ctx.fillStyle = AK_PALETTE.textPrimary;
  ctx.font = '30px noto-sans-sc-bold';
  ctx.fillText(fitText(ctx, changelog.title, heroTitleMaxW), heroTextX, heroY + 68);

  // 分割线 + 摘要（使用 middle 基线兼容 skia-canvas 各版本）
  if (summaryLines.length > 0) {
    const dividerY = heroY + 96;
    ctx.fillStyle = AK_PALETTE.hairline;
    ctx.fillRect(heroTextX, dividerY, summaryMaxW, 1);

    ctx.fillStyle = AK_PALETTE.textSecondary;
    ctx.font = '15px noto-sans-sc-medium';
    ctx.textBaseline = 'middle';
    let sy = dividerY + 14 + summaryLineH / 2;
    for (const line of summaryLines) {
      ctx.fillText(line, heroTextX, sy);
      sy += summaryLineH;
    }
  }

  // ── 分类更新模块 ───────────────────────────────────────────────
  let curY = sectionsStartY;
  for (let sIdx = 0; sIdx < measuredSections.length; sIdx++) {
    const sec = measuredSections[sIdx];
    const panelH = sec.panelHeight;

    drawChamferBox(
      ctx,
      PAD_X,
      curY,
      INNER_W,
      panelH,
      { tl: 0, tr: 12, br: 0, bl: 10 },
      AK_PALETTE.panel,
      AK_PALETTE.panelBorder,
      1
    );

    // 左侧分组色条
    ctx.fillStyle = sec.style.accent;
    ctx.fillRect(PAD_X, curY, 4, panelH - 10);

    // 模块头部底色带
    ctx.fillStyle = 'rgba(255, 255, 255, 0.025)';
    ctx.fillRect(PAD_X + 4, curY + 1, INNER_W - 14, sectionHeaderH - 1);

    // 标签胶囊（切角 Badge）
    ctx.font = '13px noto-sans-sc-bold';
    const tagText = sec.tag;
    const tagW = Math.max(58, Math.ceil(ctx.measureText(tagText).width) + 22);
    const tagH = 24;
    const tagX = PAD_X + 20;
    const tagY = curY + Math.floor((sectionHeaderH - tagH) / 2);

    drawChamferBox(
      ctx,
      tagX,
      tagY,
      tagW,
      tagH,
      { tl: 6, tr: 0, br: 6, bl: 0 },
      sec.style.bg,
      sec.style.accent,
      1
    );
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = sec.style.text;
    ctx.fillText(tagText, tagX + tagW / 2, tagY + tagH / 2);

    // 分组标题
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = AK_PALETTE.textPrimary;
    ctx.font = '19px noto-sans-sc-bold';
    ctx.fillText(
      fitText(ctx, sec.title, INNER_W - tagW - 130),
      tagX + tagW + 14,
      curY + sectionHeaderH / 2
    );

    // 右侧序号 / 条目数标注
    const countLabel = `${String(sIdx + 1).padStart(2, '0')} // ${String(sec.wrappedItems.length).padStart(2, '0')} ITEMS`;
    ctx.textAlign = 'right';
    ctx.fillStyle = AK_PALETTE.textMuted;
    ctx.font = '12px noto-sans-sc-bold';
    ctx.fillText(countLabel, PAD_X + INNER_W - 18, curY + sectionHeaderH / 2);

    // 头部下细分隔线
    ctx.fillStyle = AK_PALETTE.hairline;
    ctx.fillRect(PAD_X + 4, curY + sectionHeaderH, INNER_W - 4, 1);

    // 绘制各条目（使用 middle 基线避免 skia-canvas top 基线偏移/裁切问题）
    let iy = curY + sectionHeaderH + sectionPadTopAfterDivider;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '15px noto-sans-sc-medium';

    for (let iIdx = 0; iIdx < sec.wrappedItems.length; iIdx++) {
      const lines = sec.wrappedItems[iIdx];
      // 菱形战术项目符号，与首行文字视觉中心对齐
      drawMiniDiamond(ctx, PAD_X + 27, iy + itemLineH / 2 - 1.5, 4.2, sec.style.accent);

      ctx.fillStyle = '#e6ebf1';
      for (const line of lines) {
        ctx.fillText(line, PAD_X + 42, iy + itemLineH / 2);
        iy += itemLineH;
      }
      if (iIdx < sec.wrappedItems.length - 1) {
        iy += itemGap;
      }
    }

    curY += panelH + SECTION_GAP;
  }

  // ── 底部 PRTS 签章条 ───────────────────────────────────────────
  ctx.fillStyle = AK_PALETTE.hairline;
  ctx.fillRect(PAD_X, footerY, INNER_W, 1);
  drawHazardStripes(ctx, PAD_X, footerY + 11, 46, 18, 'rgba(245, 197, 24, 0.35)', 9, 3);

  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = AK_PALETTE.textSecondary;
  ctx.font = '14px noto-sans-sc-medium';
  let fy = footerY + 20;
  for (const line of footerLines) {
    ctx.fillText(line, PAD_X + 58, fy);
    fy += 20;
  }

  // 右下角微缩菱形与条形码
  drawRhodesDiamond(ctx, PAD_X + INNER_W - 118, footerY + 21, 9, 'rgba(34, 187, 255, 0.45)', 1.2);
  drawBarcode(ctx, PAD_X + INNER_W - 96, footerY + 12, 18, 'rgba(255, 255, 255, 0.28)');

  return canvas.toBuffer('png');
}
