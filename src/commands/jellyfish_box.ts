import { Config } from '..';
import { Context, Logger, Session } from 'koishi';
import { JellyfishBox } from '../database';
//import { paresMessageList } from "../utils";
import _ from 'lodash';

const logger = new Logger('mizuki-bot-jellyfish');

const GetJellyfishBox = async (ctx: Context, id: string, platform: string) => {
  let query: JellyfishBox[] = [];
  query = await ctx.database.get('mzk_jellyfish_box', {
    user_id: id,
    platform: platform
  });
  if (query.length === 0) {
    query.push(await ctx.database.create('mzk_jellyfish_box', {
      user_id: id,
      platform: platform,
      last_catch_time: new Date(Date.now() - 2 * 60 * 60 * 1000),
      last_refresh_time: new Date(Date.now() - 2 * 60 * 60 * 1000),
      jellyfish: [],
      decoration: [],
      salinity: 25,
      temperature: 25,
      draw_style: 'normal'
    }));
  }

  return query[0];
};

export async function command_jellyfish_box(config: Config, ctx: Context, session: Session) {
  const uid = session.event.user.id;
  

  const jellyfish_box = await GetJellyfishBox(ctx, uid, session.platform);

  let refresh = false;
  let refresh_time = 0;

  if (jellyfish_box.last_refresh_time.getTime() + 1 * 60 * 60 * 1000 < Date.now()) {
    refresh = true;
    // 要更新的次数，每小时一次
    refresh_time = Math.floor(Date.now() / (1 * 60 * 60 * 1000));
    if (refresh_time > 168) refresh_time = 24; // 超过7天未抓，减少刷新次数
    else if (refresh_time > 72) refresh_time = 12;  //超过3天未抓，减少刷新次数
  }

  return JSON.stringify({
    ...jellyfish_box,
    refresh_time,
    refresh
  }, null, 2);

  if (refresh) {
    logger.debug(`正在刷新${uid}的水母箱`);
    const last_refresh_time = jellyfish_box.last_refresh_time;
    // 将刷新时间设置为当前时间的整小时
    jellyfish_box.last_refresh_time = new Date(last_refresh_time.getFullYear(),
      last_refresh_time.getMonth(),
      last_refresh_time.getDate(),
      last_refresh_time.getHours(), 0, 0);
    if (jellyfish_box.jellyfish.length === 0) {
      // 没有水母，仅更新时间
    } else {
      // 有水母，更新水母
    }
  }

  console.log(`jellyfish_box: ${JSON.stringify(jellyfish_box, null, 2)}`);
  return JSON.stringify(jellyfish_box, null, 2);
}

export async function command_jellyfish_box_catch(config: Config, ctx: Context, session: Session) {
  // 水母箱.抓水母
  const uid = session.event.user.id;
  const platform = session.platform;
  const jellyfish_box = await GetJellyfishBox(ctx, uid, platform);
  const last_catch_time = jellyfish_box.last_catch_time;

  // 需要超过2小时才能抓
  if (last_catch_time.getTime() + 2 * 60 * 60 * 1000 > Date.now()) {
    const remain = (last_catch_time.getTime() + 2 * 60 * 60 * 1000 - Date.now()) / 1000;
    const hours = Math.floor(remain / 3600);
    const minutes = Math.floor((remain % 3600) / 60);
    const seconds = Math.floor(remain % 60);
    return `别抓啦，过${hours ? hours + '小时' : ''}${minutes ? minutes + '分' : ''}${seconds}秒再来吧！`;
  }

  jellyfish_box.last_catch_time = new Date(Date.now());
  // const meta: JellyfishMeta[] = await ctx.database.get('mzk_jellyfish_meta', {});
  // 水母箱里的水母总数
  const jellyfish_num = jellyfish_box.jellyfish.reduce((pre, cur) => pre + cur.number, 0);
  if (jellyfish_num >= 256) {
    return '别抓啦，水母箱里的水母太多了！';
  }

  // 随机抓取数量
  let catch_num = 0;
  if(jellyfish_box.jellyfish.length === 0) {
    catch_num = _.random(4, 6);
  } else {
    if (jellyfish_num < 10)
      catch_num = _.random(3, 4);
    else if (jellyfish_num < 20)
      catch_num = _.random(2, 3);
    else if (jellyfish_num < 50)
      catch_num = _.random(1, 2);
    else
      catch_num = 1;
  }

  // 随机水母种类
  const group = ['perfect', 'great', 'good', 'normal', 'special'];
  let group_probability = [0.02, 0.08, 0.50, 0.40, 0.00];
  // 特殊日期
  if (new Date().getMonth() === 3 && new Date().getDate() === 22) {
    group_probability = [0.02, 0.08, 0.45, 0.25, 0.20];
  }
  
  // 根据group_probability概率选择一组
  // 累积概率数组
  const cumulative_p = group_probability.reduce((acc, prob, index) => {
    acc.push((acc[index - 1] || 0) + prob);
    return acc;
  }, [] as number[]);

  // 生成随机数
  const random = Math.random();
  // 找到随机数对应的group
  const selected_group = group[cumulative_p.findIndex((p) => p > random)];

  // 查找所有该组的水母
  const group_meta = await ctx.database.get('mzk_jellyfish_meta', {
    group: selected_group
  });
  // 选一个
  const selected_jellyfish = group_meta[_.random(0, group_meta.length - 1)];

  // 如果水母箱里没有就添加，有就更新number
  const jellyfish_index = jellyfish_box.jellyfish.findIndex(jelly => jelly.id === selected_jellyfish.id);
  if (jellyfish_index === -1) {
    jellyfish_box.jellyfish.push({
      id: selected_jellyfish.id,
      number: catch_num
    });
  } else {
    jellyfish_box.jellyfish[jellyfish_index].number += catch_num;
  }
  await ctx.database.set('mzk_jellyfish_box', jellyfish_box.id, {
    last_catch_time: jellyfish_box.last_catch_time,
    jellyfish: jellyfish_box.jellyfish
  });

  const now = await GetJellyfishBox(ctx, uid, platform);
  return JSON.stringify(now, null, 2);
}