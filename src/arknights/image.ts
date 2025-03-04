import { Context } from 'koishi';
//import path from 'path';
import type { CanvasRenderingContext2D } from '@ltxhhz/koishi-plugin-skia-canvas';
import { random } from 'lodash';

export const CropSkin = async (ctx: Context, skinFilePath: string, cropPercent: number) => {
  const { Canvas, loadImage } = ctx.skia;

  const image = await loadImage(skinFilePath);
  //const canvas = new Canvas(image.width, image.height);
  //const skiaCtx = canvas.getContext('2d') as CanvasRenderingContext2D;

  const cropWidth = image.width * cropPercent * 0.01;
  const cropHeight = image.height * cropPercent * 0.01;

  const crop = (width, height) => {
    const x = random(0, image.width - width);
    const y = random(0, image.height - height);

    const cropCanvas = new Canvas(width, height);
    const cropCtx = cropCanvas.getContext('2d') as CanvasRenderingContext2D;
    cropCtx.drawImage(image, x, y, width, height, 0, 0, width, height);
    // check the ratio of transparent pixels
    const imgData = cropCtx.getImageData(0, 0, width, height);
    const totalPixels = width * height;
    let transparentPixels = 0;
    for (let i = 0; i < imgData.data.length; i += 4) {
      if (imgData.data[i + 3] === 0) {
        transparentPixels++;
      }
    }
    const ratio = transparentPixels / totalPixels;
    if (ratio > 0.3) 
      return crop(width, height);
    else 
      return cropCanvas;
  };

  return crop(cropWidth, cropHeight);
};