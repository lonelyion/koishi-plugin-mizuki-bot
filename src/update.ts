import axios from 'axios';
import * as fs from 'fs/promises';
import { Context, Logger } from 'koishi';
import * as path from 'path';
import { RefreshToken } from './skland/api';

const ARKNIGHTS_RES_URLS = [
  'gamedata/excel/character_table.json',
  'gamedata/excel/skin_table.json'
];

export const RefreshUserTokens = async (ctx: Context) => {
  //logger.info('开始刷新用户Token');
  const logger: Logger = ctx.logger('mizuki-bot-update');
  const users = await ctx.database.get('mzk_user', {});
  let count = 0;
  for (const user of users) {
    if (!user.skland_token) continue;
    //logger.info(`正在刷新 ${user.nickname ?? user.id} 的Token: ${user.skland_token}`);
    if (Date.now() - new Date(user.skland_last_refresh).getTime() > 30 * 60 * 1000) {
      const token = await RefreshToken(user.skland_cred, user.skland_token);
      if (token) {
        await ctx.database.set('mzk_user', { id: user.id }, {
          skland_token: token,
          skland_last_refresh: new Date(Date.now())
        });
        count++;
      }
      await new Promise(resolve => setTimeout(resolve, 10)); //wait 10ms
    }
  }
  if(count !== 0) logger.info(`刷新用户Token完成，共刷新了${count}个`);
};


export const jellyfishBoxCheck = async (ctx: Context, root: string) => {
  const logger = ctx.logger('mizuki-bot-update');
  const cdn = ctx.config.remote;
  const localVersionFile = path.join(root, 'jelly_version.txt');
  let localVersion = '0';
  //console.log(`local_version_file: ${local_version_file}`);
  try {
    const content = await fs.readFile(localVersionFile);
    localVersion = content.toString();
  } catch {
    await fs.writeFile(localVersionFile, '0', { encoding: 'utf-8' });
  }

  try {
    const { data } : {data:string} = await axios.get(`${cdn}/version.txt`);
    logger.info(`当前本地水母箱资源版本： ${localVersion}, 最新: ${data}`);
    if (Number(data) > Number(localVersion)) {
      ctx.emit('mizuki/resource_update', data);
    }
  } catch (err) {
    logger.error('读取水母箱资源版本失败', err.message);
  }
};

export const jellyfishBoxUpdate = async (ctx: Context, root: string, version: string) => {
  const logger = ctx.logger('mizuki-bot-update');
  const localVersionFile = path.join(root, 'jelly_version.txt');
  const cdn = ctx.config.remote;
  const list = await axios.get(`${cdn}/list.txt`, { responseType: 'text' });
  const files = list.data.split('\n');

  for (let i = 0; i < files.length; i++) {
    logger.info(`正在下载 ${i + 1} / ${files.length} 个文件`);
    const name = files[i];
    if (name === '') continue;
    const file_path = path.join(root, name);
    const remote = `${cdn}/${name}`;
    //console.log(`file_path: ${file_path}, remote: ${remote}`);
    fs.mkdir(path.dirname(file_path), { recursive: true });
    const res = await axios.get(remote, { responseType: 'arraybuffer' });
    await fs.writeFile(file_path, res.data);
  }

  await fs.writeFile(localVersionFile, version.toString(), { encoding: 'utf-8' });
  // 读取 data/jellyfish.json
  await ctx.database.remove('mzk_jellyfish_meta', {});
  await ctx.database.remove('mzk_jellyfish_event_meta', {});
  const json = await fs.readFile(path.join(root, 'data', 'jellyfish.json'), { encoding: 'utf-8' });
  const meta = JSON.parse(json);
  await ctx.model.upsert('mzk_jellyfish_meta', () => meta.jellyfishes);
  await ctx.model.upsert('mzk_jellyfish_event_meta', () => meta.events);

  // 清除用户水母箱中现在已经不存在的水母id
  const jellyfish_boxes = await ctx.database.get('mzk_jellyfish_box', {});
  for (let i = 0; i < jellyfish_boxes.length; i++) {
    const jellyfish_box = jellyfish_boxes[i];
    const new_jellyfish = jellyfish_box.jellyfish.filter((jellyfish) => {
      return meta.jellyfishes.some((meta_jellyfish) => {
        return meta_jellyfish.id === jellyfish.id;
      });
    });
    jellyfish_box.jellyfish = new_jellyfish;
    await ctx.database.set('mzk_jellyfish_box', { user_id: jellyfish_box.user_id }, {
      jellyfish: jellyfish_box.jellyfish
    });
  }

  logger.info('已更新水母箱数据库');
};

export const arknightsDataCheck = async (ctx: Context, root: string) => {
  const logger = ctx.logger('mizuki-bot-update');
  try {
    const url = `${ctx.config.arknightsGameResource}/version`;
    const localVersionFile = path.join(root, 'arknights_version.txt');
    let localVersion = '00-00-00-00-00-00-abcdef';
    try {
      const content = await fs.readFile(localVersionFile);
      localVersion = content.toString();
    } catch {
      fs.writeFile(localVersionFile, localVersion, { encoding: 'utf-8' });
    }

    const { data }: { data: string } = await axios.get(url);
    logger.info(`当前本地明日方舟资源版本： ${localVersion}, 最新: ${data}`);
    if (data !== localVersion) {
      const remote = data.split('-').slice(0, -1).map(Number);
      const local = localVersion.split('-').slice(0, -1).map(Number);

      for (let i = 0; i < 6; i++) {
        if (remote[i] > local[i]) {
          ctx.emit('mizuki/arknights_update', data);
          return;
        }
      }
    }
  } catch (err) {
    logger.error('检查明日方舟资源版本失败', err.message);
  };
};

export const arknightsDataUpdate = async (ctx: Context, root: string, version: string) => {
  const logger = ctx.logger('mizuki-bot-update');
  const localVersionFile = path.join(root, 'arknights_version.txt');
  let count = 0;
  for (const url of ARKNIGHTS_RES_URLS) {
    try {
      logger.info(`正在下载 ${++count} / ${ARKNIGHTS_RES_URLS.length} 个文件`);
      const { data } = await axios.get(`${ctx.config.arknightsGameResource}/${url}`, { responseType: 'arraybuffer' });
      const localPath = path.join(root, `arknights/${url}`);
      await fs.mkdir(path.dirname(localPath), { recursive: true });
      await fs.writeFile(localPath, data);
    } catch(err) { 
      logger.error(`下载明日方舟数据失败: ${url}\n${err.message}`);
    }
  }
  await fs.writeFile(localVersionFile, version, { encoding: 'utf-8' });
  logger.info('已更新明日方舟数据');
};