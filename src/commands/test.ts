import { Config } from '..';
import { Context, Logger, Session } from 'koishi';
import type { Canvas, CanvasRenderingContext2D } from '@ltxhhz/koishi-plugin-skia-canvas'; //引入类型
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

  // 将新的画布宽高设置为最长边的正方形，然后放到中间
  const max = _.max([crop_width, crop_height]);
  const dx = (max - crop_width) / 2;
  const dy = (max - crop_height) / 2;
  const crop_canvas = new Canvas(max, max);
  const crop_ctx = crop_canvas.getContext('2d');
  crop_ctx.drawImage(image, left, top, crop_width, crop_height, dx, dy, crop_width, crop_height);
  return crop_canvas;
}

function cropCanvas(ctx: Context, canvas: Canvas, x: number, y: number, width: number, height: number) {
  const { Canvas } = ctx.skia;
  const crop_canvas = new Canvas(width, height);
  const crop_ctx = crop_canvas.getContext('2d');
  crop_ctx.drawImage(canvas, x, y, width, height, 0, 0, width, height);
  return crop_canvas;
}

function createIrregularMaskPath(ctx: CanvasRenderingContext2D, imageData: ImageData) {
  const { data, width, height } = imageData;
  const path: { x: number; y: number }[] = [];
  const visited = new Set<string>();

  // 检查像素是否非透明
  function isPixelOpaque(x: number, y: number): boolean {
    if (x < 0 || y < 0 || x >= width || y >= height) return false;
    const index = (y * width + x) * 4;
    return data[index + 3] > 0; // Alpha 值大于 0 表示非透明
  }

  // 8个方向：顺序为上、右上、右、右下、下、左下、左、左上
  const directions = [
    { dx: 0, dy: -1 },  // 上
    { dx: 1, dy: -1 },  // 右上
    { dx: 1, dy: 0 },   // 右
    { dx: 1, dy: 1 },   // 右下
    { dx: 0, dy: 1 },   // 下
    { dx: -1, dy: 1 },  // 左下
    { dx: -1, dy: 0 },  // 左
    { dx: -1, dy: -1 } // 左上
  ];

  // 跟踪轮廓路径
  function traceBoundary(startX: number, startY: number) {
    let x = startX;
    let y = startY;

    let direction = 0; // 当前方向，从上开始
    const startKey = `${x},${y}`;
    const path: { x: number; y: number }[] = [];

    do {
      const key = `${x},${y}`;
      if (!visited.has(key)) {
        visited.add(key);
        path.push({ x, y });
      }

      // 查找下一个邻居
      let foundNext = false;
      for (let i = 0; i < 8; i++) {
        const idx = (direction + i) % 8; // 从当前方向顺时针检查
        const nx = x + directions[idx].dx;
        const ny = y + directions[idx].dy;

        if (isPixelOpaque(nx, ny)) {
          x = nx;
          y = ny;
          direction = (idx + 6) % 8; // 调整方向为下一个像素的逆时针方向
          foundNext = true;
          break;
        }
      }

      // 如果找不到下一个点，停止循环
      if (!foundNext) {
        break;
      }
    } while (`${x},${y}` !== startKey);

    return path;
  }

  // 寻找第一个非透明像素并追踪边界
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (isPixelOpaque(x, y)) {
        const boundaryPath = traceBoundary(x, y);
        path.push(...boundaryPath);
        break outer;
      }
    }
  }

  // 使用 ctx.beginPath() 绘制路径
  if (path.length > 0) {
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (let i = 1; i < path.length; i++) {
      ctx.lineTo(path[i].x, path[i].y);
    }
    ctx.closePath();
  }

}

type DialogTextSegment = {
  text: string;
  font: string;
  size: number;
  color: string;
}

async function drawDialogCanvas(ctx: Context, segments: DialogTextSegment[], width: number = 672): Promise<Canvas> {
  // 这个是最里面的多行文本，用蓝色边框包住的
  const { Canvas, loadImage } = ctx.skia;

  const canvas = new Canvas(width, 672);
  const skia_ctx = canvas.getContext('2d');

  // skia_ctx.fillStyle = 'lightblue';
  // skia_ctx.fillRect(0, 0, width, 672);

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
  return cropCanvas(ctx, canvas, 0, 0, width, new_h);
}

async function drawCommonMessageBoxCanvas(ctx: Context, title: string, segments: DialogTextSegment[]): Promise<Canvas> {
  const { Canvas } = ctx.skia;

  const canvas = new Canvas(672, 768);
  const skia_ctx = canvas.getContext('2d');

  // skia_ctx.fillStyle = '#FFFFFFC0';
  // skia_ctx.fillRect(0, 0, canvas.width, canvas.height);

  skia_ctx.font = '36px fusion-pixel-12px';
  skia_ctx.textAlign = 'left';
  skia_ctx.fillStyle = '#263238';

  skia_ctx.fillText(title, 24, 36);

  const textCanvas = await drawDialogCanvas(ctx, segments);

  skia_ctx.drawCanvas(textCanvas, 0, 48);

  // calculate height
  const height = 48 + textCanvas.height;
  return cropCanvas(ctx, canvas, 0, 0, canvas.width, height);
}

async function drawNewJellyfishCanvas(ctx: Context): Promise<Canvas> {
  const { Canvas, loadImage } = ctx.skia;
  const canvas = new Canvas(672, 200);

  const skia_ctx = canvas.getContext('2d');

  // skia_ctx.fillStyle = 'cadetblue';
  // skia_ctx.fillRect(0, 0, canvas.width, canvas.height);

  skia_ctx.font = '36px fusion-pixel-12px';
  skia_ctx.textAlign = 'left';
  skia_ctx.fillStyle = '#263238';

  skia_ctx.fillText('新增水母', 24, 36);

  const textCanvas = await drawDialogCanvas(ctx, [
    { text: ' ', font: 'fusion-pixel-12px', size: 12, color: '#FFFFFF' },
    { text: '这还是水母吗', font: 'fusion-pixel-12px', size: 24, color: '#f06292' },
    { text: '数量 x1', font: 'fusion-pixel-12px', size: 12, color: '#f06292' },
    { text: '我觉得我是', font: 'fusion-pixel-12px', size: 12, color: '#6a1b9a' },
    { text: ' ', font: 'fusion-pixel-12px', size: 12, color: '#FFFFFF' }
  ], canvas.width - 136);

  // 获取bubble_img的中心坐标
  const d = textCanvas.height;
  const center_x = d / 2;
  const center_y = d / 2 + 48;

  // 计算水母泡泡的内容绘图起点坐标
  // 圆内的最大正方形的左上角点
  const start_x = center_x - d / 2 / Math.SQRT2;
  const start_y = center_y - d / 2 / Math.SQRT2;

  // 计算正方形的边长
  const side = d / Math.SQRT2;

  const bubble_img = await loadImage(path.join(ctx.baseDir, 'data', 'mizuki-bot', 'image', 'new_jelly_bubble.png'));
  const jelly_img = await processJellyfishImage(ctx, path.join(ctx.baseDir, 'data', 'mizuki-bot', 'image', 'jellyfish/pixel', 'prts_mzk.png'));

  // 将水母图片绘制在bubble_img的中心，大小缩放为正方形边长
  skia_ctx.drawImage(jelly_img, 0, 0, jelly_img.width, jelly_img.height, start_x, start_y, side, side);
  //skia_ctx.fillStyle = 'red';
  //skia_ctx.fillRect(start_x, start_y, side, side);
  // 然后绘制上一层的泡泡图片
  skia_ctx.drawImage(bubble_img, 0, 0, bubble_img.width, bubble_img.height, 0, 48, d, d);

  // 绘制右侧的稀有度
  skia_ctx.font = '24px fusion-pixel-12px';
  skia_ctx.textAlign = 'right';
  skia_ctx.fillStyle = '#ffb300';
  skia_ctx.fillText('NORMAL', canvas.width - 16, 48 + d / 2 + 12);

  // 再画一个半透明的旋转45°的水母
  // 放在textCanvas的最右边
  
  skia_ctx.save();
  skia_ctx.translate(d + 8, 48);
  createIrregularMaskPath(skia_ctx, textCanvas.getContext('2d').getImageData(0, 0, textCanvas.width, textCanvas.height));
  // 根据 textCanvas的边界，确定一个遮罩范围
  // skia_ctx.strokeStyle = 'red';
  // skia_ctx.lineWidth = 1;
  // skia_ctx.stroke();
  skia_ctx.clip();
  //skia_ctx.restore();

  //skia_ctx.save();
  skia_ctx.globalAlpha = 0.7;
  skia_ctx.translate(canvas.width / 2, canvas.height / 2);
  skia_ctx.rotate(Math.PI / -4);
  skia_ctx.drawImage(jelly_img, 0, 0, jelly_img.width, jelly_img.height, 32 , 0, d*1.5, d*1.5);
  skia_ctx.restore();

  skia_ctx.drawCanvas(textCanvas, d + 8, 48);
  
  const height = d + 48;
  await canvas.saveAs(path.join(ctx.baseDir, 'data', 'mizuki-bot', 'temp', 'test.png'));
  return cropCanvas(ctx, canvas, 0, 0, canvas.width, height);
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
  skia_ctx.fillStyle = '#f0f0f0';
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
        box_ctx.restore();  // 恢复之前保存的状态
      }

    } catch (error) {
      logger.error('打开水母图片失败', error);
      continue;
    }
  }

  skia_ctx.drawCanvas(box_canvas, 48, 192);
  skia_ctx.drawImage(jellyfish_box_border_img, 48, 192);  // 这里绘制到y=608了

  let current_height = 608 + 16;

  // 新增水母
  const new_jelly_canvas = await drawNewJellyfishCanvas(ctx);
  skia_ctx.drawCanvas(new_jelly_canvas, 48, current_height);
  current_height += new_jelly_canvas.height + 16;

  // 事件列表
  const events_list_canvas = await drawCommonMessageBoxCanvas(ctx, '事件列表', [
    { text: '水母正在欢快的游泳~', font: 'fusion-pixel-12px', size: 24, color: '#263238' },
    { text: '什么都没有发生', font: 'fusion-pixel-12px', size: 12, color: '#263238' }
  ]);
  skia_ctx.drawCanvas(events_list_canvas, 48, current_height);
  current_height += events_list_canvas.height + 16;

  // 帮助
  const commands_help_canvas = await drawCommonMessageBoxCanvas(ctx, '指令提示', [
    { text: '水母箱 -h', font: 'fusion-pixel-12px', size: 24, color: '#263238' },
    { text: '查看水母箱指令介绍', font: 'fusion-pixel-12px', size: 12, color: '#263238' },
    { text: '水母箱 抓水母', font: 'fusion-pixel-12px', size: 24, color: '#263238' },
    { text: '抓几只水母进水母箱（每2小时可以抓一次）', font: 'fusion-pixel-12px', size: 12, color: '#263238' }
  ]);
  skia_ctx.drawCanvas(commands_help_canvas, 48, current_height);

  // 下面的内容应该是width=672=border_img.width

  // 绘制指令提示


  // 先暂时放后面


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
  await canvas.saveAs(path.join(root, 'temp', 'output.png'), { format: 'png' });

  const buffer = await canvas.toBuffer('png');

  return h.image(buffer, 'image/png');
}