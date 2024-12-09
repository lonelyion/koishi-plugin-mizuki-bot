import type {} from '@ltxhhz/koishi-plugin-skia-canvas'; //引入类型
import { Context, h } from 'koishi';
import * as path from 'path';

export async function DrawJellyfishBox(ctx: Context) {
  const { Canvas, loadImage } = ctx.skia;

  const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');

  const canvas = new Canvas(768, 864);
  const drawContext = canvas.getContext('2d');

  const image = await loadImage(path.join(root, 'image', 'normal_tr_deco.png'));

  drawContext.drawImage(image, 0, 0);
  

  return h('image', canvas.toBuffer('png'));
}