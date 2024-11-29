import { Config } from '..';
import { Context, Logger, Session } from 'koishi';
import { JellyfishBox } from '../database';
//import { paresMessageList } from "../utils";
import _ from 'lodash';
import { RandomChoose, RandomChooseWithWeights } from '../utils';


const logger = new Logger('mizuki-bot-jellyfish');


// eslint-disable-next-line @typescript-eslint/no-unused-vars
const DrawJellyfishBox = async (ctx: Context, jellyfish_box: JellyfishBox) => {
  return;
};

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

const GetJellyfishInBoxCount = (jellyfish_box: JellyfishBox) => {
  return jellyfish_box.jellyfish.reduce((pre, cur) => pre + cur.number, 0);
};

const CalculateBoxEvents = async (ctx: Context, jellyfish_box: JellyfishBox) => {
  let refresh = false;
  let refresh_number = 0;
  const last_time = jellyfish_box.last_refresh_time;

  if (last_time.getTime() + 1 * 60 * 60 * 1000 < Date.now()) {
    refresh = true;
    // 要更新的次数，每小时一次
    refresh_number = Math.floor(Date.now() - last_time.getTime() / (1 * 60 * 60 * 1000));
    if (refresh_number > 168) refresh_number = 24; // 超过7天未抓，减少刷新次数
    else if (refresh_number > 72) refresh_number = 12;  //超过3天未抓，减少刷新次数
  }

  if (jellyfish_box.user_id === ctx.config.test_account) {
    refresh = true;
    refresh_number = 10;
  }


  if (!refresh) return [];
  // if (_.size(jellyfish_box.jellyfish) === 0) {
  //   // 没有水母，仅更新时间
  //   return {};
  // }

  // 准备事件
  const events = [];

  const jellyfish_num = GetJellyfishInBoxCount(jellyfish_box);
  const ids = jellyfish_box.jellyfish.map((jellyfish) => jellyfish.id);
  const jellyfish_meta = await ctx.database.get('mzk_jellyfish_meta', { id: { $in: ids } });
  
  // 更新繁殖
  jellyfish_box.jellyfish.forEach((item) => {
    let num_to_add = 0;
    const meta = jellyfish_meta.find((m) => m.id === item.id);
    if (meta.reproductive_rate === 0) return;

    const reproductive_rate = meta.reproductive_rate;
    let rate = reproductive_rate / 30 / 24 * item.number * refresh_number;
    //logger.info('位置1的rate:', rate);

    if (jellyfish_num > 50) {
      rate = rate / jellyfish_num;
    }
    //logger.info('位置2的rate:', rate);
    
    if (rate > 1) {
      num_to_add = Math.floor(rate);
      rate -= num_to_add;
    }

    if(rate > 0 && RandomChooseWithWeights([rate, 1 - rate], [true, false])) {
      num_to_add += 1;
    }
    
    if (num_to_add > 0) {
      item.number += num_to_add;
      events.push({
        'id': 'reproductive',
        'name': '繁殖',
        'description': `在水母箱中繁殖出了${num_to_add}只新的${meta.name}`
      });
    }
  });

  // 更新事件
  const event_meta = await ctx.database.get('mzk_jellyfish_event_meta', {});
  const event_probabilities = event_meta.map((item) => item.probability);
  // 计算概率以及次数
  let event_probabilities_sum = event_probabilities.reduce((pre, cur) => pre + cur, 0) * refresh_number;
  let event_number = 0;
  if(event_probabilities_sum > 1) {
    event_number += Math.floor(event_probabilities_sum);
  }
  event_probabilities_sum -= event_number;
  if(event_probabilities_sum > 0 && RandomChooseWithWeights([event_probabilities_sum, 1 - event_probabilities_sum], [true, false])) {
    event_number += 1;
  }
  
  if (event_number > 0) {
    for (let i = 0; i < event_number; i++) {
      const event = RandomChoose(event_meta);
      // TODO: 各种事件及其随机处理
      switch (event.type) {
      case 'reduce':
        // 水母减少的事件
        break;
      case 'add':
        // 水母增加的事件
        break;
      case 'change':
        // 水母变化的事件
        break;
      default:  //normal
        break;
      }
      events.push({
        'id': event.id,
        'name': event.name,
        'description': event.description
      });
    }
  }

  // 更新时间
  if (_.size(events) !== 0) jellyfish_box.last_refresh_time = new Date(Date.now() );
  // 写入数据库
  await ctx.database.set('mzk_jellyfish_box', jellyfish_box.id, {
    last_refresh_time: jellyfish_box.last_refresh_time,
    jellyfish: jellyfish_box.jellyfish
  });
  return events;
};

export async function CommandJellyfishBox(config: Config, ctx: Context, session: Session) {
  const uid = session.event.user.id;
  

  const jellyfish_box = await GetJellyfishBox(ctx, uid, session.platform);
  const events = await CalculateBoxEvents(ctx, jellyfish_box);

  return JSON.stringify({
    ...jellyfish_box,
    events: events
  }, null, 2);
}

export async function CommandJellyfishBoxCatch(config: Config, ctx: Context, session: Session) {
  // 水母箱.抓水母
  const uid = session.event.user.id;
  const platform = session.platform;
  let jellyfish_box = await GetJellyfishBox(ctx, uid, platform);
  const last_catch_time = jellyfish_box.last_catch_time;

  // 需要超过2小时才能抓
  if (uid !== config.test_account && last_catch_time.getTime() + 2 * 60 * 60 * 1000 > Date.now()) {
    const remain = (last_catch_time.getTime() + 2 * 60 * 60 * 1000 - Date.now()) / 1000;
    const hours = Math.floor(remain / 3600);
    const minutes = Math.floor((remain % 3600) / 60);
    const seconds = Math.floor(remain % 60);
    return `别抓啦，过${hours ? hours + '小时' : ''}${minutes ? minutes + '分' : ''}${seconds}秒再来吧！`;
  }

  jellyfish_box.last_catch_time = new Date(Date.now());
  // const meta: JellyfishMeta[] = await ctx.database.get('mzk_jellyfish_meta', {});
  // 水母箱里的水母总数
  const jellyfish_num = GetJellyfishInBoxCount(jellyfish_box);
  if (jellyfish_num >= 256) {
    return '别抓啦，水母箱里的水母太多了！';
  }

  // 在正式开始抓水母之前，先过一遍事件
  const events = await CalculateBoxEvents(ctx, jellyfish_box);
  // 事已至此只能重新拿一下水母箱对象了
  jellyfish_box = await GetJellyfishBox(ctx, uid, platform);
  let added = {};
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
  const selected_group = RandomChooseWithWeights(group_probability, group);
  // 查找所有该组的水母
  const group_meta = await ctx.database.get('mzk_jellyfish_meta', {
    group: selected_group
  });
  // 选一个
  const selected_jellyfish = RandomChoose(group_meta);
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
  added = {
    'id': selected_jellyfish.id,
    'number': catch_num
  };
  // 写入数据库
  await ctx.database.set('mzk_jellyfish_box', jellyfish_box.id, {
    last_catch_time: jellyfish_box.last_catch_time,
    jellyfish: jellyfish_box.jellyfish
  });

  const now = await GetJellyfishBox(ctx, uid, platform);
  return JSON.stringify({
    ...now,
    events: events,
    added
  }, null, 2);
}

