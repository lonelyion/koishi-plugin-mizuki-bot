import { Config } from '..';
import { Context, Logger, Session } from 'koishi';
import type {} from '@ltxhhz/koishi-plugin-skia-canvas'; //引入类型
import { h } from 'koishi';
import * as path from 'path';

const logger = new Logger('mizuki-bot-test');

export async function CommandTest(config: Config, ctx: Context, session: Session) {
  const { Canvas, loadImage } = ctx.skia;

  const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');
  const test_image = path.join(root, 'image', 'jelly_1.png');

  const image = await loadImage(test_image);
  
  
  const user = session.username;

  const canvas = new Canvas(500, 500);
  const board = canvas.getContext('2d');

  // 绘制一个矩形
  board.fillStyle = 'blue';
  board.fillRect(50, 50, 400, 400);

  // 绘制文字
  board.fillStyle = 'white';
  board.font = '48px Noto Sans SC';
  board.fillText(`Hello, ${user}`, 100, 250);

  // 绘制图片
  board.drawImage(image, 10, 10);


  logger.info('绘制完成');

  const buffer = await canvas.toBuffer('png');

  return h.image(buffer, 'image/png');
}