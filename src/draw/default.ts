import { Context, Logger, Session } from 'koishi';
import { Jellyfish, JellyfishBox } from '../database';
import path from 'path';
import { Config } from '..';
import { ProcessJellyfishImage } from './utils';
import _ from 'lodash';
import type { CanvasRenderingContext2D } from '@ltxhhz/koishi-plugin-skia-canvas';
import type { JellyfishBoxEvent } from '../commands/jellyfish_box';

const logger = new Logger('mizuki-bot-draw-normal');

const drawRoundRect = (ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) => {
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, radius);
  ctx.closePath();
  ctx.clip();
  ctx.fillRect(x, y, width, height);
  ctx.restore();
}

export const DrawDefaultTheme = async (koishiCtx: Context, config: Config, session: Session,
  jellyfishBox: JellyfishBox, newJelly?: Jellyfish, events?: JellyfishBoxEvent[],
  isCatch: boolean = false) => {
  const { Canvas, loadImage, FontLibrary } = koishiCtx.skia;

  const root = path.join(koishiCtx.baseDir, 'data/mizuki-bot');
  const imageRoot = path.join(root, 'image');
  const fontRoot = path.join(root, 'font');
  const jellyRoot = path.join(imageRoot, 'jellyfish/default');
  const themeRoot = path.join(imageRoot, '/theme/default');

  const help = [
    {
      id: 'help1',
      name: '水母箱 -h',
      description: '查看水母箱指令介绍'
    },
    !isCatch ? {
      id: 'help2',
      name: '水母箱 抓水母',
      description: '抓几只水母进水母箱'
    } : null,
  ].filter(Boolean);

  // 加载字体
  FontLibrary.use('unifont', path.join(fontRoot, 'unifont-16.0.02.otf'));
  FontLibrary.use('fusion-pixel-12px', path.join(fontRoot, 'fusion-pixel-12px-proportional-zh_hans.otf'));
  FontLibrary.use('noto-sans-sc-regular', path.join(fontRoot, 'NotoSansSC-Regular.ttf'));
  FontLibrary.use('noto-sans-sc-medium', path.join(fontRoot, 'NotoSansSC-Medium.ttf'));
  FontLibrary.use('noto-sans-sc-bold', path.join(fontRoot, 'NotoSansSC-Bold.ttf'));

  const newJellyCanvas = await DrawNewJellyfishCardCanvas(koishiCtx, config, newJelly, jellyRoot);
  const eventsCanvas = await DrawGeneralCardCanvas(koishiCtx, config, '事件列表', events);
  const helpCanvas = await DrawGeneralCardCanvas(koishiCtx, config, '指令帮助', help);

  // 检查是否为null并计算高度
  const height = 608
    + (newJellyCanvas ? newJellyCanvas.height + 16 : 0)
    + (eventsCanvas ? eventsCanvas.height + 16 : 0)
    + (helpCanvas ? helpCanvas.height + 16 : 0)
    + 16;
  const canvas = new Canvas(768, height);
  const ctx = canvas.getContext('2d');

  // 绘制背景色
  if (config.theme.background.useColor) {
    ctx.fillStyle = config.theme.background.color;
    ctx.fillRect(0, 0, 768, height);
  } else {
    const background = await loadImage(path.join(themeRoot, 'background.png'));
    ctx.drawImage(background, 0, 0, background.width, background.height, 0, 0, 768, height);
  }

  // 绘制装饰
  const trDeco = await loadImage(path.join(themeRoot, 'tr_deco.png'));
  ctx.drawImage(trDeco, 768 - trDeco.width, 0);

  // 绘制用户头像
  const defaultUserAvatar = path.join(themeRoot, 'default_avatar.png');
  const avatarImage = await loadImage(session.event.user.avatar ?? defaultUserAvatar);
  const avatarSize = 96;
  const avatarCanvas = new Canvas(avatarSize, avatarSize);
  const avatarCtx = avatarCanvas.getContext('2d');
  const radius = avatarCanvas.width / 2;
  avatarCtx.beginPath();
  avatarCtx.arc(radius, radius, radius, 0, Math.PI * 2);
  avatarCtx.closePath();
  avatarCtx.clip();
  avatarCtx.drawImage(avatarImage, 0, 0, avatarSize, avatarSize);
  ctx.drawCanvas(avatarCanvas, 80, 64);

  // 绘制用户名
  ctx.font = '48px noto-sans-sc-bold';
  ctx.fillStyle = config.theme.name;
  ctx.textAlign = 'left';
  const nameMetrics = ctx.measureText(session.event.user.name);
  ctx.fillText(session.event.user.name, 80 + avatarSize + 24, 64 + nameMetrics.actualBoundingBoxAscent);

  // 绘制日期
  ctx.fillStyle = '#7986cb';
  ctx.font = '24px noto-sans-sc-medium';
  ctx.textAlign = 'right';
  const date = '〇 ' + new Date().toLocaleDateString();
  const dateMetrics = ctx.measureText(date);
  ctx.fillText(date, 688, 150 + dateMetrics.actualBoundingBoxAscent);

  // 绘制水母箱背景
  const boxCanvas = new Canvas(672, 416);
  const { width: backW, height: backH } = boxCanvas;
  const boxCtx = boxCanvas.getContext('2d');
  boxCtx.fillStyle = config.theme.boxBackground;
  drawRoundRect(boxCtx, 4, 4, backW - 8, backH - 8, 8);
  const centerX = backW / 2;
  const centerY = backH / 2;

  // 绘制水母箱边框
  ctx.fillStyle = config.theme.boxOutline;
  drawRoundRect(ctx, 48, 192, 672, 416, 12);


  // 绘制水母们
  const meta = await koishiCtx.database.get('mzk_jellyfish_meta', {});
  const jellys = jellyfishBox.jellyfish;
  for (let i = 0; i < jellys.length; i++) {
    const jelly = jellys[i];
    const { id, number } = jelly;
    const jellyImagePath = path.join(jellyRoot, `${id}.png`);

    try {
      const jellyCanvas = await ProcessJellyfishImage(koishiCtx, jellyImagePath);
      // find the draw.size from meta
      const jellyMeta = meta.find(meta => meta.id === id);
      const drawSize = jellyMeta.draw.size;

      for (let j = 0; j < number; j++) {
        const w = jellyCanvas.width;
        const h = jellyCanvas.height;
        const ratio = 32 / Math.max(w, h) || drawSize;  //TODO: 替换为 drawSize
        const drawW = w * ratio;
        const drawH = h * ratio;
        const x = centerX + _.random(-centerX + drawW, centerX - drawW);
        const y = centerY + _.random(-centerY + drawH, centerY - drawH);
        const direction = _.random(-180, 180) * (Math.PI / 180); // 转为弧度
        boxCtx.save(); //保存当前画布状态
        boxCtx.translate(x, y);  // 移动到目标中心点
        boxCtx.rotate(direction); // 应用旋转
        boxCtx.drawCanvas(jellyCanvas, -drawW / 2, -drawH / 2, drawW, drawH); // 绘制水母
        boxCtx.restore();  // 恢复之前保存的状态
      }

    } catch (error) {
      logger.error('打开水母图片失败', error);
      continue;
    }
  }
  ctx.drawCanvas(boxCanvas, 48, 192); // 这里绘制到y=608了

  let currentHeight = 608 + 16;

  // 新增水母
  if (newJellyCanvas) {
    ctx.drawCanvas(newJellyCanvas, 48, currentHeight);
    currentHeight += newJellyCanvas.height + 16;
  }

  // 事件列表
  if (eventsCanvas) {
    ctx.drawCanvas(eventsCanvas, 48, currentHeight);
    currentHeight += eventsCanvas.height + 16;
  }

  // 指令帮助
  if (helpCanvas) {
    ctx.drawCanvas(helpCanvas, 48, currentHeight);
    currentHeight += helpCanvas.height + 16;
  }

  // 调试
  await canvas.saveAs(path.join(root, '/temp/output.png'));

  return await canvas.toBuffer('png');
};


const DrawNewJellyfishCardCanvas = async (koishiCtx: Context, config: Config, newJelly?: Jellyfish, jellyRoot?: string) => {

  const { Canvas } = koishiCtx.skia;

  if (!newJelly || !jellyRoot) {
    return null;
  }

  const width = 768 - 48 * 2; // 672
  const height = 200;
  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  const newJellyImage = await ProcessJellyfishImage(koishiCtx, path.join(jellyRoot, `${newJelly.id}.png`));

  const meta = await koishiCtx.database.get('mzk_jellyfish_meta', { id: newJelly.id });
  const name = meta[0].name;

  ctx.fillStyle = config.theme.cardBackground;
  drawRoundRect(ctx, 0, 0, width, height, 16);

  ctx.fillStyle = config.theme.title;
  ctx.font = '30px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText('新增', 24, 36 + 2);

  const iconCanvas = new Canvas(128, 128);
  const iconCtx = iconCanvas.getContext('2d');
  // 绘制水母图标边框
  iconCtx.fillStyle = config.theme.jellyIconBorder;
  drawRoundRect(iconCtx, 0, 0, 128, 128, 8);
  // 绘制水母图标背景
  iconCtx.fillStyle = config.theme.jellyIconBackground;
  drawRoundRect(iconCtx, 4, 4, 120, 120, 4);

  // 绘制水母图标
  iconCtx.drawCanvas(newJellyImage, 0, 0, newJellyImage.width, newJellyImage.height, 12, 12, 104, 104);
  ctx.drawCanvas(iconCanvas, 24, 52);  // 36 + 16 = 52

  // 在右下角绘制一个半透明水母
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(0, 0, width, height, 16);
  ctx.closePath();
  ctx.clip();
  ctx.globalAlpha = 0.3;
  ctx.translate(width - 100, height - 100);
  ctx.rotate(Math.PI / -4);
  ctx.drawCanvas(newJellyImage, 0, 0, newJellyImage.width, newJellyImage.height, -110, -80, 220, 220);
  ctx.restore();

  // 绘制水母名称
  ctx.fillStyle = config.theme.jellyName;
  ctx.font = '30px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText(name, 24 + 128 + 16, 84); // 52 + 32 = 84

  // 绘制水母描述
  ctx.fillStyle = config.theme.eventDescription;
  ctx.font = '22px noto-sans-sc-regular';
  ctx.textAlign = 'left';
  const description = meta[0].description;

  const maxWidth = width - (24 + 128 + 16 + 24); // 右边距24px
  const lineHeight = 26;
  const maxLines = 2;
  let lines = [];
  let currentLine = '';
  let chars = description;

  for (let i = 0; i < chars.length; i++) {
    let potentialLine = currentLine + chars[i];
    let metrics = ctx.measureText(potentialLine);
    if (metrics.width > maxWidth) {
      if (lines.length >= maxLines) {
        currentLine += '...';
        lines.push(currentLine);
        break;
      }
      lines.push(currentLine);
      currentLine = chars[i];
    } else {
      currentLine = potentialLine;
      if (i === chars.length - 1) {
        lines.push(currentLine);
      }
    }
  }

  lines.forEach((line, index) => {
    ctx.fillText(line, 24 + 128 + 16, 110 + index * lineHeight + 4);  // 84 + 26 = 110
  });

  // 绘制数量
  ctx.fillStyle = config.theme.jellyName;
  ctx.font = '24px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText(`×${newJelly.number}`, 24 + 128 + 16, 114 + lines.length * lineHeight + 4);

  // 在数量后面绘制稀有度
  const group = meta[0].group;
  const groupColor = config.theme.groups[group];
  ctx.fillStyle = groupColor;
  ctx.font = '24px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText(`${group.toUpperCase()}`, 24 + 128 + 16 + ctx.measureText(`×${newJelly.number}`).width + 8, 114 + lines.length * lineHeight + 4);

  return canvas;
}

const DrawGeneralCardCanvas = async (koishiCtx: Context, config: Config, title: string, events?: JellyfishBoxEvent[]) => {

  const { Canvas } = koishiCtx.skia;

  if (!events || events.length === 0) {
    return null;
  }

  const width = 768 - 48 * 2; // 672

  // 计算需要的总高度
  const height = 38 + events.length * (26 + 36) + 16;

  const canvas = new Canvas(width, height);
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = config.theme.cardBackground;
  drawRoundRect(ctx, 0, 0, width, height, 16);

  ctx.fillStyle = config.theme.title;
  ctx.font = '30px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText(title, 24, 38);
  // ctx.fillStyle = 'red';
  // ctx.fillRect(24, 38, 100, 1);

  let currentHeight = 38 + 30 + 8;

  // 绘制事件
  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    ctx.fillStyle = config.theme.eventTitle;
    ctx.font = '30px noto-sans-sc-medium';
    ctx.textAlign = 'left';
    ctx.fillText(event.name, 24, currentHeight);
    // ctx.fillStyle = 'red';
    // ctx.fillRect(24, currentHeight, 100, 1);
    currentHeight += 30 - 4;  // = 26

    ctx.fillStyle = config.theme.eventDescription;
    ctx.font = '22px noto-sans-sc-regular';
    ctx.textAlign = 'left';
    ctx.fillText(event.description, 24, currentHeight);
    // ctx.fillStyle = 'blue';
    // ctx.fillRect(24, currentHeight, 100, 1);
    currentHeight += 24 + 12; // = 36
  }

  return canvas;
}