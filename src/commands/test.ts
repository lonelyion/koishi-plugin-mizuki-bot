import { Config } from '..';
import { Context, Logger, Session } from 'koishi';
import type { Canvas } from '@ltxhhz/koishi-plugin-skia-canvas'; //引入类型
import { h } from 'koishi';
import * as path from 'path';
import { GetJellyfishBox } from './jellyfish_box';
import _ from 'lodash';

const logger = new Logger('mizuki-bot-test');

const getImagePath = (root, filename: string) => {
  return path.join(root, 'image', filename);
};

const getFontPath = (root, filename: string) => {
  return path.join(root, 'font', filename);
};

async function processJellyfishImage(ctx: Context, image_path: string): Promise<Canvas> {
  const { Canvas, loadImage } = ctx.skia;

  //加载图片
  const image = await loadImage(image_path);

  const canvas = new Canvas(image.width, image.height);
  const skia_ctx = canvas.getContext('2d');
  skia_ctx.drawImage(image, 0, 0);

  //提取裁剪范围
  const image_data = skia_ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { width, height, data } = image_data;
  let top = height, bottom = 0, left = width, right = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const alpha = data[(y * width + x) * 4 + 3]; // 获取 alpha 通道
      if (alpha > 0) { // 非透明像素
        if (x < left) left = x;
        if (x > right) right = x;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
      }
    }
  }

  // 裁剪后的宽高
  const crop_width = right - left + 1;
  const crop_height = bottom - top + 1;

  const crop_canvas = new Canvas(crop_width, crop_height);
  const crop_ctx = crop_canvas.getContext('2d');
  crop_ctx.drawImage(image, left, top, crop_width, crop_height, 0, 0, crop_width, crop_height);

  return crop_canvas;
}

type DialogTextSegment = {
  text: string;
  font: string;
  size: number;
  color: string;
}

async function drawDialogCanvas(ctx: Context, segments: DialogTextSegment[], width: number = 672) : Promise<Canvas> {
  // 这个是最里面的多行文本，用蓝色边框包住的
  const { Canvas, loadImage } = ctx.skia;

  const canvas = new Canvas(width, 672);
  const skia_ctx = canvas.getContext('2d');

  skia_ctx.fillStyle = 'lightblue';
  skia_ctx.fillRect(0, 0, width, 672);

  const slice = {
    top: 24,
    right: 24,
    bottom: 24,
    left: 24
  };

  const padding = 8;
  let y = padding;

  for (const segment of segments) {
    skia_ctx.font = `${segment.size}px ${segment.font}`;
    skia_ctx.textAlign = 'left';
    skia_ctx.fillStyle = segment.color;
    skia_ctx.fillText(segment.text, slice.left, y + segment.size);
    y += segment.size + padding;
  }

  // 边框
  const image = await loadImage(path.join(ctx.baseDir, 'data', 'mizuki-bot', 'image', 'message_box.png'));
  
  const center_width = image.width - slice.left - slice.right;
  const center_height = image.height - slice.top - slice.bottom;

  const text_height = y + padding;
  
  skia_ctx.drawImage(image, 0, 0, slice.left, slice.top, 0, 0, slice.left, slice.top);
  skia_ctx.drawImage(image, slice.left, 0, center_width, slice.top, slice.left, 0, width - slice.left - slice.right, slice.top);
  skia_ctx.drawImage(image, image.width - slice.right, 0, slice.right, slice.top, width - slice.right, 0, slice.right, slice.top);
  skia_ctx.drawImage(image, 0, slice.top, slice.left, center_height, 0, slice.top, slice.left, text_height - slice.top - slice.bottom);
  skia_ctx.drawImage(image, slice.left, slice.top, center_width, center_height, slice.left, slice.top, width - slice.left - slice.right, text_height - slice.top - slice.bottom);
  skia_ctx.drawImage(image, image.width - slice.right, slice.top, slice.right, center_height, width - slice.right, slice.top, slice.right, text_height - slice.top - slice.bottom);
  skia_ctx.drawImage(image, 0, image.height - slice.bottom, slice.left, slice.bottom, 0, text_height - slice.bottom, slice.left, slice.bottom);
  skia_ctx.drawImage(image, slice.left, image.height - slice.bottom, center_width, slice.bottom, slice.left, text_height - slice.bottom, width - slice.left - slice.right, slice.bottom);
  skia_ctx.drawImage(image, image.width - slice.right, image.height - slice.bottom, slice.right, slice.bottom, width - slice.right, text_height - slice.bottom, slice.right, slice.bottom);


  // 裁剪底部不需要的像素
  const new_h = text_height;
  const crop_canvas = new Canvas(width, new_h);
  const crop_ctx = crop_canvas.getContext('2d');
  crop_ctx.drawCanvas(canvas, 0, 0, width, new_h, 0, 0, width, new_h);

  return crop_canvas;
}

async function drawCommandsHelpCanvas(ctx: Context) : Promise<Canvas> {
  const { Canvas } = ctx.skia;

  const canvas = new Canvas(672, 768);
  const skia_ctx = canvas.getContext('2d');

  skia_ctx.fillStyle = '#FFFFFFC0';
  skia_ctx.fillRect(0, 0, canvas.width, canvas.height);

  skia_ctx.font = '36px fusion-pixel-12px';
  skia_ctx.textAlign = 'left';
  skia_ctx.fillStyle = '#263238';

  skia_ctx.fillText('指令提示', 24, 36);

  const textCanvas = await drawDialogCanvas(ctx, [
    { text: '水母箱 -h', font: 'fusion-pixel-12px', size: 24, color: '#263238' },  
    { text: '查看水母箱指令介绍', font: 'fusion-pixel-12px', size: 12, color: '#263238' },
    { text: '水母箱 抓水母', font: 'fusion-pixel-12px', size: 24, color: '#263238' },
    { text: '抓几只水母进水母箱（每2小时可以抓一次）', font: 'fusion-pixel-12px', size: 12, color: '#263238' }
  ]);
  
  skia_ctx.drawCanvas(textCanvas, 0, 48);
  
  return canvas;
}

export async function CommandTest(config: Config, ctx: Context, session: Session) {
  const { Canvas, loadImage, FontLibrary } = ctx.skia;

  const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');

  const tr_deco_img_path = getImagePath(root, 'normal_tr_deco.png');
  const default_user_avatar = getImagePath(root, '明日方舟·音律联觉-灯下定影-可爱.png');

  const tr_deco_img = await loadImage(tr_deco_img_path);
  
  const user = session.username;
  const avatar_url = session.event.user.avatar;

  const jellyfish_box = await GetJellyfishBox(ctx, session.event.user.id, session.platform);

  const canvas = new Canvas(768, 1152);
  const skia_ctx = canvas.getContext('2d');

  // 绘制背景
  skia_ctx.fillStyle = '#e0e0e0';
  skia_ctx.fillRect(0, 0, canvas.width, canvas.height);

  // 绘制右上角装饰
  skia_ctx.drawImage(tr_deco_img, 768 - tr_deco_img.width, 0);

  // 绘制用户头像，圆角
  const avatar_img = await loadImage(avatar_url ?? default_user_avatar);
  const avatar_size = 96;
  const temp_canvas = new Canvas(avatar_size, avatar_size);
  const temp_ctx = temp_canvas.getContext('2d');

  const radius = temp_canvas.width / 2;
  temp_ctx.beginPath();
  temp_ctx.arc(radius, radius, radius, 0, Math.PI * 2); // 定义圆形路径
  temp_ctx.closePath();
  temp_ctx.clip();
  temp_ctx.drawImage(avatar_img, 0, 0, avatar_size, avatar_size);
  skia_ctx.drawCanvas(temp_canvas, 80, 64);

  // 绘制用户名
  FontLibrary.use('unifont', getFontPath(root, 'unifont-16.0.02.otf'));
  FontLibrary.use('fusion-pixel-12px', getFontPath(root, 'fusion-pixel-12px-proportional-zh_hans.otf'));
  skia_ctx.fillStyle = '#263238';
  skia_ctx.font = '48px fusion-pixel-12px';
  skia_ctx.textAlign = 'left';
  const metrics = skia_ctx.measureText(user);
  skia_ctx.fillText(user, 80 + avatar_size + 24, 64 + metrics.actualBoundingBoxAscent);


  // 绘制日期
  skia_ctx.fillStyle = '#7986cb';
  skia_ctx.font = '24px fusion-pixel-12px';
  skia_ctx.textAlign = 'right';
  const date = '〇 ' + new Date().toLocaleDateString();
  const metrics_date = skia_ctx.measureText(date);
  skia_ctx.fillText(date, 688, 150 + metrics_date.actualBoundingBoxAscent);

  // 绘制水母箱背景
  
  const jellyfish_box_border_img_path = getImagePath(root, 'box_border.png');
  const jellyfish_box_border_img = await loadImage(jellyfish_box_border_img_path);
  
  const { width: back_w, height: back_h } = jellyfish_box_border_img;
  const box_canvas = new Canvas(back_w, back_h);
  const box_ctx = box_canvas.getContext('2d');
  box_ctx.fillStyle = '#1a237eC0';
  box_ctx.fillRect(16, 16, back_w - 32, back_h - 32);
  const center_x = back_w / 2;
  const center_y = back_h / 2;
  //skia_ctx.fillRect(64, 208, back_w - 32, back_h - 32);

  // 绘制水母箱
  const meta = await ctx.database.get('mzk_jellyfish_meta', {});
  const jellys = jellyfish_box.jellyfish;
  for (let i = 0; i < jellys.length; i++) {
    const jelly = jellys[i];
    const { id, number } = jelly;
    const jelly_img_path = getImagePath(root, `/jellyfish/pixel/${id}.png`);

    try {
      const jelly_canvas = await processJellyfishImage(ctx, jelly_img_path);
      // find the draw.size from meta
      const jelly_meta = meta.find(meta => meta.id === id);
      const drawSize = jelly_meta.draw.size;  

      for (let j = 0; j < number; j++) {
        const w = jelly_canvas.width;
        const h = jelly_canvas.height;
        const ratio = 32 / Math.max(w, h) || drawSize;  //TODO: 替换为 drawSize
        const draw_w = w * ratio; 
        const draw_h = h * ratio;
        const x = center_x + _.random(-center_x + draw_w, center_x - draw_w);
        const y = center_y + _.random(-center_y + draw_h, center_y - draw_h);
        const direction = _.random(-180, 180) * (Math.PI / 180); // 转为弧度
        box_ctx.save(); //保存当前画布状态
        box_ctx.translate(x, y);  // 移动到目标中心点
        box_ctx.rotate(direction); // 应用旋转
        box_ctx.drawCanvas(jelly_canvas, -draw_w / 2, -draw_h / 2, draw_w, draw_h); // 绘制水母
        //box_ctx.drawCanvas(jelly_canvas , x, y, draw_w, draw_h);
        box_ctx.restore();  // 恢复之前保存的状态
      }

    } catch (error) {
      logger.error('打开水母图片失败', error);
      continue;
    }
  }
  
  skia_ctx.drawCanvas(box_canvas, 48, 192);
  skia_ctx.drawImage(jellyfish_box_border_img, 48, 192);  // 这里绘制到y=608了

  // 下面的内容应该是width=672=border_img.width

  // 绘制指令提示
  const commands_help_canvas = await drawCommandsHelpCanvas(ctx); 
  skia_ctx.drawCanvas(commands_help_canvas, 48, 608 + 16);
  
  
  // 水母箱的背景 #1a237e
  // 对话框背景 #eeeeee
  // 用户名/标题 #263238
  // 日期 #7986cb
  // 新增水母名字 #f06292
  // 新增水母描述 #6a1b9a
  // normal #ffb300
  // good #2baf2b
  // great #e91e63
  // special #4dd0e1
  // perfect #f48fb1 -> #03a9f4


  logger.info('绘制完成');

  const buffer = await canvas.toBuffer('png');

  return h.image(buffer, 'image/png');
}