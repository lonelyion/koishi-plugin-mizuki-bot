import { Context } from 'koishi';
import type { Canvas, CanvasRenderingContext2D } from '@ltxhhz/koishi-plugin-skia-canvas';
import { randomInt } from '../utils/random';

const MAX_CROP_ATTEMPTS = 30;
const MAX_TRANSPARENT_RATIO = 0.3;

/**
 * 从立绘中随机裁切一块方形区域，尽量避开大面积透明背景。
 * 使用有界循环代替无界递归，杜绝栈溢出风险。
 */
export async function cropSkin(ctx: Context, skinFilePath: string, cropPercent: number): Promise<Canvas> {
  const { Canvas, loadImage } = ctx.skia;
  const image = await loadImage(skinFilePath);

  const rawSize = Math.floor((Math.max(image.width, image.height) * cropPercent) / 100);
  const size = Math.max(1, Math.min(rawSize, image.width, image.height));
  const maxX = Math.max(0, image.width - size);
  const maxY = Math.max(0, image.height - size);
  const totalPixels = size * size;

  let bestCanvas: Canvas | null = null;
  let bestTransparentRatio = 1;

  for (let attempt = 0; attempt < MAX_CROP_ATTEMPTS; attempt++) {
    const x = randomInt(0, maxX);
    const y = randomInt(0, maxY);

    const cropCanvas = new Canvas(size, size);
    const cropCtx = cropCanvas.getContext('2d') as CanvasRenderingContext2D;
    cropCtx.drawImage(image, x, y, size, size, 0, 0, size, size);

    const imgData = cropCtx.getImageData(0, 0, size, size);
    let transparentPixels = 0;
    for (let i = 3; i < imgData.data.length; i += 4) {
      if (imgData.data[i] === 0) {
        transparentPixels += 1;
      }
    }

    const ratio = transparentPixels / totalPixels;
    if (ratio <= MAX_TRANSPARENT_RATIO) {
      return cropCanvas;
    }

    if (ratio < bestTransparentRatio) {
      bestTransparentRatio = ratio;
      bestCanvas = cropCanvas;
    }
  }

  return bestCanvas!;
}

export async function renderFullSkinBuffer(ctx: Context, skinFilePath: string, maxWidth = 1080): Promise<Buffer> {
  const { Canvas, loadImage } = ctx.skia;
  const image = await loadImage(skinFilePath);

  let targetWidth = image.width;
  let targetHeight = image.height;
  if (image.width > maxWidth) {
    const ratio = maxWidth / image.width;
    targetWidth = maxWidth;
    targetHeight = Math.round(image.height * ratio);
  }

  const canvas = new Canvas(targetWidth, targetHeight);
  const skiaCtx = canvas.getContext('2d');
  skiaCtx.drawImage(image, 0, 0, targetWidth, targetHeight);
  return canvas.toBuffer('png');
}
