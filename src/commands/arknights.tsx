import { Context, Session, Logger } from 'koishi';
import { loadCharacterSkins, loadCharacterTable } from '../arknights/utils';
import { ArknightsCharacter } from '../arknights/types';
import * as fs from 'fs/promises';
import path from 'path';
import axios from 'axios';
import { CropSkin } from '../arknights/image';
import { random } from 'lodash';

const logger = new Logger('mizuki-bot-arknights');

const PROFESSION = {
  'PIONEER': '先锋',
  'WARRIOR': '近卫',
  'SNIPER': '狙击',
  'TANK': '重装',
  'MEDIC': '医疗',
  'SUPPORT': '辅助',
  'CASTER': '术师',
  'SPECIAL': '特种'
};

const checkFileExist = async (filePath: string) => {
  try {
    await fs.stat(filePath);
    return true;
  } catch {
    return false;
  }
};

export const CommandArknightsOperatorGuessSkin = async (ctx: Context, session: Session) => {
  const skins = await loadCharacterSkins(ctx);
  const chars = await loadCharacterTable(ctx);
  const skin = skins[Math.floor(Math.random() * skins.length)];
  const char: ArknightsCharacter = chars[skin.charId];

  const skinFileName = `${skin.portraitId}b.png`;
  const skinUrl = `${ctx.config.arknightsGameResource}/skin/${encodeURIComponent(skinFileName)}`;
  // check if skinPos is exist
  const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');
  const filePath = path.join(root, 'arknights/skin', skinFileName);

  await session.send('正在准备题目，图片发送后你将有三次机会回答');

  if(!(await checkFileExist(filePath))) {
    // 下载图片 axios
    logger.info(`图片不存在，开始下载图片：${skinUrl}`);
    try {
      const response = await axios.get(skinUrl, { responseType: 'arraybuffer' });
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, response.data);
      logger.info(`图片下载成功: ${filePath}`);
    } catch (err) {
      logger.error(`图片下载失败: ${err}`);
      throw err;
    }
  }

  const skinData = await CropSkin(ctx, filePath, random(10, 15));

  //const skinData = await fs.readFile(filePath);
  const skinBase64 = await skinData.toDataURL('png');

  await session.send(<><img src={skinBase64} />
    博士，这是哪位干员的立绘呢？直接发送干员名字猜一猜吧！
  </>);

  let timeout = false;
  let guessCount = 0;
  let flag = false;
  

  const timers = [
    setTimeout(async () => {
      await session.send(`提示：这位干员是${char.rarity + 1}星${PROFESSION[char.profession]}干员`);
    }, 45 * 1000),
    setTimeout(async () => {
      await session.send('还有30秒钟时间...>.<');
    }, 60 * 1000),
    setTimeout(async () => {
      timeout = true;
    }, 90 * 1000)
  ];

  while (guessCount < 3 && !timeout) {
    const guess = await session.prompt(1000);
    if(guess) {
      if (guess === '不知道' || guess === 'bzd') {
        break;
      }
      guessCount++;
      if(guess === char.name || guess.toLowerCase() === char.appellation.toLowerCase()) {
        flag = true;
        break;
      } else {
        await session.send(`回答错误！还有${3 - guessCount}次机会`);
      }
    }
  }
  
  for (const timer of timers) {
    clearTimeout(timer);
  }
  const { loadImage } = ctx.skia;
  const image = await loadImage(filePath);
  let dataUrl = '';
  // reduce the image to maximum 1080px width
  if (image.width > 1080) {
    const ratio = 1080 / image.width;
    const newWidth = 1080;
    const newHeight = image.height * ratio;
    const canvas = new ctx.skia.Canvas(newWidth, newHeight);
    const skiaCtx = canvas.getContext('2d');
    skiaCtx.drawImage(image, 0, 0, newWidth, newHeight);
    dataUrl = await canvas.toDataURL('png', { quality: 0.8 });
  } else {
    const canvas = new ctx.skia.Canvas(image.width, image.height);
    const skiaCtx = canvas.getContext('2d');
    skiaCtx.drawImage(image, 0, 0);
    dataUrl = await canvas.toDataURL('png', { quality: 0.8 });
  }
  return flag ? <><img src={dataUrl} />恭喜博士回答正确！这是{char.name}的{skin.displaySkin.skinGroupName}皮肤</> : 
    <><img src={dataUrl} />杂鱼博士没有猜到，正确答案是{char.name}（{skin.displaySkin.skinGroupName}）</>;
};
