import { Context } from 'koishi';
//import path from 'path';
import type { CanvasRenderingContext2D } from '@ltxhhz/koishi-plugin-skia-canvas';
import { random } from 'lodash';

export const CropSkin = async (ctx: Context, skinFilePath: string, cropPercent: number) => {
  const { Canvas, loadImage } = ctx.skia;

  const image = await loadImage(skinFilePath);
  //const canvas = new Canvas(image.width, image.height);
  //const skiaCtx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const cropSize = Math.max(image.width, image.height) * cropPercent / 100;

  const crop = (size) => {
    const x = random(0, image.width - size);
    const y = random(0, image.height - size);

    const cropCanvas = new Canvas(size, size);
    const cropCtx = cropCanvas.getContext('2d') as CanvasRenderingContext2D;
    cropCtx.drawImage(image, x, y, size, size, 0, 0, size, size);
    // check the ratio of transparent pixels
    const imgData = cropCtx.getImageData(0, 0, size, size);
    const totalPixels = size * size;
    let transparentPixels = 0;
    for (let i = 0; i < imgData.data.length; i += 4) {
      if (imgData.data[i + 3] === 0) {
        transparentPixels++;
      }
    }
    const ratio = transparentPixels / totalPixels;
    if (ratio > 0.3) 
      return crop(size);
    else 
      return cropCanvas;
  };

  return crop(cropSize);
};