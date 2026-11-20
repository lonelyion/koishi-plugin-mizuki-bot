import * as path from 'path';
import { Context } from 'koishi';
import { Config } from '../config';
import { assetCache } from '../jellyfish/renderer';
import {
  AK_PALETTE,
  drawArknightsBackground,
  drawBarcode,
  drawChamferBox,
  drawCornerBrackets,
  drawHazardStripes,
  fitText
} from './ui_primitives';
import { CellMatch, formatOperatorSummary, WordleGame } from './wordle';

const BOARD_WIDTH = 788;
const PADDING_X = 32;
const INDEX_COL_WIDTH = 44;
const HEADER_HEIGHT = 128;
const TABLE_HEADER_HEIGHT = 38;
const ROW_HEIGHT = 54;
const ROW_GAP = 7;
const FOOTER_HEIGHT = 76;

const COLUMNS = [
  { label: '干员', en: 'OPERATOR', width: 164 },
  { label: '星级', en: 'RARITY', width: 96 },
  { label: '职业', en: 'CLASS', width: 104 },
  { label: '分支', en: 'BRANCH', width: 148 },
  { label: '阵营', en: 'FACTION', width: 143 }
] as const;

const COL_GAP = 5;

const CELL_STYLES: Record<CellMatch, { bg: string; border: string; accent: string; text: string }> = {
  exact: {
    bg: 'rgba(36, 159, 104, 0.26)',
    border: 'rgba(54, 211, 139, 0.72)',
    accent: AK_PALETTE.greenBright,
    text: '#f0fff6'
  },
  close: {
    bg: 'rgba(201, 128, 20, 0.28)',
    border: 'rgba(245, 184, 65, 0.78)',
    accent: AK_PALETTE.amberBright,
    text: '#fff9eb'
  },
  miss: {
    bg: '#1f2329',
    border: '#343a44',
    accent: '#4a5360',
    text: '#b6c0ce'
  }
};

function resolveFontRoot(ctx: Context, config: Config): string {
  const localDir = config.localResourceDir?.trim();
  const root = localDir ? path.resolve(ctx.baseDir, localDir) : path.join(ctx.baseDir, 'data', 'mizuki-bot');
  return path.join(root, 'font');
}

export async function renderWordleBoard(
  koishiCtx: Context,
  config: Config,
  game: WordleGame
): Promise<Buffer> {
  const { Canvas } = koishiCtx.skia;
  try {
    assetCache.ensureFonts(koishiCtx, resolveFontRoot(koishiCtx, config));
  } catch {
    // 字体尚未下载时允许回退系统字体
  }

  const showFooter = game.status !== 'playing';
  const rowsToShow = game.maxGuesses;
  const bodyHeight = TABLE_HEADER_HEIGHT + rowsToShow * (ROW_HEIGHT + ROW_GAP);
  const totalHeight = HEADER_HEIGHT + bodyHeight + (showFooter ? FOOTER_HEIGHT + 24 : 34);

  const canvas = new Canvas(BOARD_WIDTH, totalHeight);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  // 1. PRTS 炭黑工业风背景 + 网格 + RHODES 水印
  drawArknightsBackground(ctx, BOARD_WIDTH, totalHeight, 'PRTS // WORDLE');

  // 顶部警戒细条与左青色主标识条
  ctx.fillStyle = '#0c0e11';
  ctx.fillRect(0, 0, BOARD_WIDTH, 28);
  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.fillRect(0, 0, 120, 28);
  drawHazardStripes(ctx, 126, 4, 84, 20, 'rgba(245, 197, 24, 0.55)', 10, 3);

  ctx.fillStyle = '#0c0e11';
  ctx.font = '14px noto-sans-sc-bold';
  ctx.textAlign = 'center';
  ctx.fillText('PRTS.SYS', 60, 19);

  ctx.fillStyle = AK_PALETTE.textMuted;
  ctx.font = '13px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText('RHODES ISLAND // OPERATOR DEDUCTION', 220, 19);

  ctx.textAlign = 'right';
  ctx.fillStyle = AK_PALETTE.textSecondary;
  ctx.fillText(`ATTEMPT [ ${String(game.guesses.length).padStart(2, '0')} / ${String(game.maxGuesses).padStart(2, '0')} ]`, BOARD_WIDTH - PADDING_X, 19);

  // 2. 主标题栏（左白大标题 + 右状态铭牌）
  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.fillRect(PADDING_X, 46, 5, 36);

  ctx.fillStyle = AK_PALETTE.textPrimary;
  ctx.font = '30px noto-sans-sc-bold';
  ctx.textAlign = 'left';
  ctx.fillText('干员属性推理', PADDING_X + 16, 75);

  ctx.fillStyle = AK_PALETTE.textMuted;
  ctx.font = '13px noto-sans-sc-medium';
  ctx.fillText('OPERATOR WORDLE', PADDING_X + 206, 73);

  // 右侧切角状态标签
  const isWin = game.status === 'won';
  const isEnd = game.status !== 'playing';
  const badgeColor = isWin
    ? AK_PALETTE.greenBright
    : isEnd
      ? AK_PALETTE.yellow
      : AK_PALETTE.cyan;
  const badgeText = isWin
    ? 'MATCH CONFIRMED · 推理成功'
    : game.status === 'lost'
      ? 'LIMIT REACHED · 次数用尽'
      : game.status === 'surrendered'
        ? 'ABORTED · 已提前揭晓'
        : 'SCANNING · 推理进行中';

  ctx.font = '15px noto-sans-sc-bold';
  const badgeW = ctx.measureText(badgeText).width + 30;
  drawChamferBox(
    ctx,
    BOARD_WIDTH - PADDING_X - badgeW,
    48,
    badgeW,
    32,
    { tl: 8, br: 8 },
    'rgba(16, 18, 22, 0.85)',
    badgeColor,
    1.5
  );
  ctx.fillStyle = badgeColor;
  ctx.textAlign = 'center';
  ctx.fillText(badgeText, BOARD_WIDTH - PADDING_X - badgeW / 2, 69);

  // 图例条（锐利工业色块）
  const legendY = 96;
  ctx.strokeStyle = AK_PALETTE.hairline;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(PADDING_X, legendY - 6);
  ctx.lineTo(BOARD_WIDTH - PADDING_X, legendY - 6);
  ctx.stroke();

  const legends: ReadonlyArray<readonly [string, string]> = [
    [AK_PALETTE.greenBright, '完全吻合'],
    [AK_PALETTE.amberBright, '星级差1 / 同职业不同分支 / 关联阵营'],
    ['#4a5360', '不符']
  ];
  let lx = PADDING_X;
  ctx.font = '14px noto-sans-sc-regular';
  ctx.textAlign = 'left';
  for (const [color, label] of legends) {
    ctx.fillStyle = color;
    ctx.fillRect(lx, legendY + 4, 14, 10);
    ctx.fillStyle = AK_PALETTE.textSecondary;
    ctx.fillText(label, lx + 20, legendY + 14);
    lx += 20 + ctx.measureText(label).width + 24;
  }
  drawBarcode(ctx, BOARD_WIDTH - PADDING_X - 58, legendY + 2, 14);

  // 3. 表头栏
  const tableTop = HEADER_HEIGHT;
  const startX = PADDING_X + INDEX_COL_WIDTH + COL_GAP;

  // 序号列表头
  drawChamferBox(ctx, PADDING_X, tableTop, INDEX_COL_WIDTH, TABLE_HEADER_HEIGHT - 6, { tl: 6 }, '#0f1114', AK_PALETTE.panelBorder, 1);
  ctx.fillStyle = AK_PALETTE.textMuted;
  ctx.font = '13px noto-sans-sc-bold';
  ctx.textAlign = 'center';
  ctx.fillText('#', PADDING_X + INDEX_COL_WIDTH / 2, tableTop + 21);

  let colX = startX;
  for (const col of COLUMNS) {
    drawChamferBox(ctx, colX, tableTop, col.width, TABLE_HEADER_HEIGHT - 6, { tr: 6 }, '#0f1114', AK_PALETTE.panelBorder, 1);
    ctx.fillStyle = AK_PALETTE.textPrimary;
    ctx.font = '15px noto-sans-sc-bold';
    ctx.textAlign = 'center';
    ctx.fillText(col.label, colX + col.width / 2, tableTop + 21);
    colX += col.width + COL_GAP;
  }

  // 4. 每一行推理记录
  for (let row = 0; row < rowsToShow; row++) {
    const rowY = tableTop + TABLE_HEADER_HEIGHT + row * (ROW_HEIGHT + ROW_GAP);
    const guess = game.guesses[row];

    // 左侧序号块（01 ~ 08）；猜中行整行（含序号格）全绿高亮
    const isRowFilled = Boolean(guess);
    const isWinRow = Boolean(guess?.isCorrect);
    drawChamferBox(
      ctx,
      PADDING_X,
      rowY,
      INDEX_COL_WIDTH,
      ROW_HEIGHT,
      { bl: 6 },
      isWinRow
        ? 'rgba(36, 159, 104, 0.38)'
        : isRowFilled
          ? '#1c2026'
          : 'rgba(20, 22, 26, 0.5)',
      isWinRow
        ? AK_PALETTE.greenBright
        : isRowFilled
          ? '#3e4652'
          : 'rgba(255, 255, 255, 0.08)',
      isWinRow ? 1.5 : 1
    );
    if (isWinRow) {
      ctx.fillStyle = AK_PALETTE.greenBright;
      ctx.fillRect(PADDING_X, rowY, 3, ROW_HEIGHT - 6);
    }
    ctx.fillStyle = isWinRow ? '#f0fff6' : isRowFilled ? AK_PALETTE.cyan : AK_PALETTE.textMuted;
    ctx.font = '15px noto-sans-sc-bold';
    ctx.textAlign = 'center';
    ctx.fillText(String(row + 1).padStart(2, '0'), PADDING_X + INDEX_COL_WIDTH / 2, rowY + 33);

    colX = startX;
    if (!guess) {
      for (const col of COLUMNS) {
        drawChamferBox(
          ctx,
          colX,
          rowY,
          col.width,
          ROW_HEIGHT,
          { br: 6 },
          'rgba(24, 27, 32, 0.48)',
          'rgba(255, 255, 255, 0.075)',
          1
        );
        // 占位中点微标
        ctx.fillStyle = 'rgba(255, 255, 255, 0.09)';
        ctx.fillRect(colX + col.width / 2 - 8, rowY + ROW_HEIGHT / 2 - 1, 16, 2);
        colX += col.width + COL_GAP;
      }
      continue;
    }

    const cells: ReadonlyArray<{ text: string; match: CellMatch; isName?: boolean }> = [
      { text: guess.operator.name, match: guess.isCorrect ? 'exact' : 'miss', isName: true },
      { text: guess.rarity.text, match: guess.rarity.match },
      { text: guess.profession.text, match: guess.profession.match },
      { text: guess.subProfession.text, match: guess.subProfession.match },
      { text: guess.faction.text, match: guess.faction.match }
    ];

    cells.forEach((cell, idx) => {
      const col = COLUMNS[idx];
      const style = isWinRow
        ? {
          bg: 'rgba(36, 159, 104, 0.36)',
          border: AK_PALETTE.greenBright,
          accent: AK_PALETTE.greenBright,
          text: '#f0fff6'
        }
        : cell.isName
          ? { bg: '#222831', border: '#4e5d70', accent: AK_PALETTE.cyan, text: AK_PALETTE.textPrimary }
          : CELL_STYLES[cell.match];

      drawChamferBox(ctx, colX, rowY, col.width, ROW_HEIGHT, { br: 7 }, style.bg, style.border, isWinRow ? 1.5 : 1.2);

      // 左侧 3px 战术状态指示条（方舟 UI 标志细节）
      ctx.fillStyle = style.accent;
      ctx.fillRect(colX, rowY, 3, ROW_HEIGHT);

      ctx.fillStyle = style.text;
      ctx.font = cell.isName ? '19px noto-sans-sc-bold' : '17px noto-sans-sc-medium';
      ctx.textAlign = 'center';
      ctx.fillText(fitText(ctx, cell.text, col.width - 18), colX + col.width / 2 + 1, rowY + 34);

      colX += col.width + COL_GAP;
    });
  }

  // 5. 结算底栏（PRTS 档案揭晓条）
  if (showFooter) {
    const footerY = tableTop + bodyHeight + 10;
    const footerW = BOARD_WIDTH - PADDING_X * 2;
    const accent = isWin ? AK_PALETTE.greenBright : AK_PALETTE.yellow;

    drawChamferBox(
      ctx,
      PADDING_X,
      footerY,
      footerW,
      FOOTER_HEIGHT - 8,
      { tl: 10, br: 10 },
      '#1a1d22',
      accent,
      1.5
    );
    drawCornerBrackets(ctx, PADDING_X + 12, footerY + 8, footerW - 24, FOOTER_HEIGHT - 24, 7, accent, 1.2);
    ctx.fillStyle = accent;
    ctx.fillRect(PADDING_X, footerY + 10, 5, FOOTER_HEIGHT - 28);

    ctx.fillStyle = accent;
    ctx.font = '13px noto-sans-sc-bold';
    ctx.textAlign = 'left';
    ctx.fillText('TARGET OPERATOR FILE // 正确答案揭晓', PADDING_X + 20, footerY + 24);

    ctx.fillStyle = AK_PALETTE.textPrimary;
    ctx.font = '21px noto-sans-sc-bold';
    ctx.fillText(
      fitText(ctx, formatOperatorSummary(game.target), footerW - 40),
      PADDING_X + 20,
      footerY + 52
    );
  }

  return canvas.toBuffer('png');
}
