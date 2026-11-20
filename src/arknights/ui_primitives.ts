import type { CanvasRenderingContext2D } from '@ltxhhz/koishi-plugin-skia-canvas';

export const AK_PALETTE = {
  bgBase: '#141619',
  bgDeep: '#101215',
  panel: '#1e2126',
  panelAlt: '#262a30',
  panelBorder: '#383e47',
  hairline: 'rgba(255, 255, 255, 0.12)',
  gridDot: 'rgba(255, 255, 255, 0.055)',
  cyan: '#22bbff',
  cyanDim: 'rgba(34, 187, 255, 0.16)',
  yellow: '#f5c518',
  yellowDim: 'rgba(245, 197, 24, 0.16)',
  green: '#249f68',
  greenBright: '#36d38b',
  amber: '#c98014',
  amberBright: '#f5b841',
  red: '#d93c3c',
  redBright: '#ff5c5c',
  textPrimary: '#f2f4f7',
  textSecondary: '#a3acb8',
  textMuted: '#68717d'
} as const;

export interface ChamferOptions {
  tl?: number;
  tr?: number;
  br?: number;
  bl?: number;
}

/**
 * 绘制明日方舟标志性的 45° 切角矩形路径。
 */
export function traceChamferRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number | ChamferOptions = 10
) {
  const tl = typeof cut === 'number' ? cut : (cut.tl ?? 0);
  const tr = typeof cut === 'number' ? cut : (cut.tr ?? 0);
  const br = typeof cut === 'number' ? cut : (cut.br ?? 0);
  const bl = typeof cut === 'number' ? cut : (cut.bl ?? 0);

  ctx.beginPath();
  ctx.moveTo(x + tl, y);
  ctx.lineTo(x + w - tr, y);
  if (tr > 0) ctx.lineTo(x + w, y + tr);
  ctx.lineTo(x + w, y + h - br);
  if (br > 0) ctx.lineTo(x + w - br, y + h);
  ctx.lineTo(x + bl, y + h);
  if (bl > 0) ctx.lineTo(x, y + h - bl);
  ctx.lineTo(x, y + tl);
  if (tl > 0) ctx.lineTo(x + tl, y);
  ctx.closePath();
}

export function drawChamferBox(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  cut: number | ChamferOptions,
  fill: string,
  stroke?: string,
  lineWidth = 1
) {
  ctx.save();
  traceChamferRect(ctx, x, y, w, h, cut);
  ctx.fillStyle = fill;
  ctx.fill();
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 绘制 PRTS 工业暗底：哑光炭黑渐变 + 精细点阵网格 + 细对角斜线纹理。
 */
export function drawArknightsBackground(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  watermarkText: string
) {
  const bg = ctx.createLinearGradient(0, 0, width, height);
  bg.addColorStop(0, '#16181c');
  bg.addColorStop(0.5, '#121417');
  bg.addColorStop(1, '#181b20');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, width, height);

  // 精细战术点阵网格
  ctx.fillStyle = AK_PALETTE.gridDot;
  const step = 28;
  for (let y = 14; y < height; y += step) {
    for (let x = 14; x < width; x += step) {
      ctx.fillRect(x, y, 2, 2);
    }
  }

  // 右下角巨大半透明战术水印文字
  ctx.save();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.032)';
  ctx.font = '88px noto-sans-sc-bold';
  ctx.textAlign = 'right';
  ctx.fillText(watermarkText, width - 20, height - 26);
  ctx.restore();

  // 顶部右侧极淡罗德岛几何菱形徽标水印
  drawRhodesDiamond(ctx, width - 92, 92, 68, 'rgba(255, 255, 255, 0.035)');
}

/**
 * 绘制简洁几何菱形徽标（致敬罗德岛/PRTS 几何视觉语言）。
 */
export function drawRhodesDiamond(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  strokeColor: string,
  lineWidth = 2
) {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = strokeColor;
  ctx.lineWidth = lineWidth;

  // 外菱形
  ctx.beginPath();
  ctx.moveTo(0, -size);
  ctx.lineTo(size, 0);
  ctx.lineTo(0, size);
  ctx.lineTo(-size, 0);
  ctx.closePath();
  ctx.stroke();

  // 内菱形
  const inner = size * 0.62;
  ctx.beginPath();
  ctx.moveTo(0, -inner);
  ctx.lineTo(inner, 0);
  ctx.lineTo(0, inner);
  ctx.lineTo(-inner, 0);
  ctx.closePath();
  ctx.stroke();

  // 中心细十字
  const cross = size * 0.24;
  ctx.beginPath();
  ctx.moveTo(-cross, 0);
  ctx.lineTo(cross, 0);
  ctx.moveTo(0, -cross);
  ctx.lineTo(0, cross);
  ctx.stroke();

  ctx.restore();
}

/**
 * 绘制工业斜条警戒纹（///），常见于明日方舟标题栏与底边装饰。
 */
export function drawHazardStripes(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  spacing = 12,
  stripeWidth = 4
) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();

  ctx.strokeStyle = color;
  ctx.lineWidth = stripeWidth;
  for (let dx = -h; dx < w + h; dx += spacing) {
    ctx.beginPath();
    ctx.moveTo(x + dx, y + h);
    ctx.lineTo(x + dx + h, y);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * 绘制直角战术定位角标（L 型护角）。
 */
export function drawCornerBrackets(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  len = 10,
  color = 'rgba(255, 255, 255, 0.35)',
  lineWidth = 1.5
) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;

  // 左上
  ctx.beginPath();
  ctx.moveTo(x, y + len);
  ctx.lineTo(x, y);
  ctx.lineTo(x + len, y);
  // 右上
  ctx.moveTo(x + w - len, y);
  ctx.lineTo(x + w, y);
  ctx.lineTo(x + w, y + len);
  // 右下
  ctx.moveTo(x + w, y + h - len);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x + w - len, y + h);
  // 左下
  ctx.moveTo(x + len, y + h);
  ctx.lineTo(x, y + h);
  ctx.lineTo(x, y + h - len);
  ctx.stroke();
  ctx.restore();
}

/**
 * 绘制 PRTS 装饰性条形码刻度。
 */
export function drawBarcode(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  h: number,
  color = 'rgba(255, 255, 255, 0.28)'
) {
  const widths = [2, 1, 3, 1, 2, 4, 1, 2, 1, 3, 2, 1, 2, 3, 1];
  ctx.save();
  ctx.fillStyle = color;
  let cx = x;
  for (let i = 0; i < widths.length; i++) {
    const w = widths[i];
    if (i % 2 === 0) {
      ctx.fillRect(cx, y, w, h);
    }
    cx += w + 2;
  }
  ctx.restore();
}

/**
 * 绘制明日方舟分段式进度条（类似理智/灯火刻度条）。
 */
export function drawSegmentedBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  valuePercent: number,
  activeColor: string,
  segments = 20
) {
  const gap = 4;
  const segW = (w - gap * (segments - 1)) / segments;
  const filledCount = Math.round((Math.max(0, Math.min(100, valuePercent)) / 100) * segments);

  ctx.save();
  for (let i = 0; i < segments; i++) {
    const sx = x + i * (segW + gap);
    const active = i < filledCount;
    // 略带斜切的平行四边形刻度块
    ctx.beginPath();
    ctx.moveTo(sx + 3, y);
    ctx.lineTo(sx + segW, y);
    ctx.lineTo(sx + segW - 3, y + h);
    ctx.lineTo(sx, y + h);
    ctx.closePath();
    ctx.fillStyle = active ? activeColor : 'rgba(255, 255, 255, 0.08)';
    ctx.fill();
  }
  ctx.restore();
}

export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = '…';
  let result = '';
  for (const ch of text) {
    if (ctx.measureText(result + ch + ellipsis).width > maxWidth) break;
    result += ch;
  }
  return result + ellipsis;
}

export function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines = 2): string[] {
  const lines: string[] = [];
  let current = '';
  for (const ch of text) {
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
  if (current) lines.push(current);
  return lines;
}
