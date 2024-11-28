import { Config } from "..";
import { Context, Logger, Session } from "koishi";
import { JellyfishBox } from "../database";
//import { paresMessageList } from "../utils";

const logger = new Logger('mizuki-bot-jellyfish');

export async function command_jellyfish_box(config: Config, ctx: Context, session: Session) {
  const uid = session.event.user.id;
  let query: JellyfishBox[] = [];
  query = await ctx.database.get('mzk_jellyfish_box', {
    user_id: uid,
    platform: session.platform
  })
  if(query.length === 0) {
    query.push(await ctx.database.create('mzk_jellyfish_box', {
      user_id: uid,
      platform: session.platform,
      last_catch_time: new Date(Date.now() - 2 * 60 * 60 * 1000),
      last_refresh_time: new Date(Date.now() - 2 * 60 * 60 * 1000),
      jellyfish: [],
      decoration: [],
      salinity: 0,
      temperature: 0,
      draw_style: 'normal'
    }));
  }

  const jellyfish_box = query[0];
  let refresh = false;
  let refresh_time = 0;

  if(jellyfish_box.last_refresh_time.getTime() + 1 * 60 * 60 * 1000 < Date.now()) {
    refresh = true;
    // 要更新的次数，每小时一次
    refresh_time = Math.floor(Date.now() / (1 * 60 * 60 * 1000));
    if(refresh_time > 168) refresh_time = 24; //超过7天未抓，减少刷新次数
    else if(refresh_time > 72) refresh_time = 12;  //超过3天未抓，减少刷新次数
  }

  if(refresh) {
    logger.debug(`正在刷新${uid}的水母箱`);
    const last_refresh_time = jellyfish_box.last_refresh_time;
    // 将刷新时间设置为当前时间的整小时
    jellyfish_box.last_refresh_time = new Date(last_refresh_time.getFullYear(), 
                                                last_refresh_time.getMonth(), 
                                                last_refresh_time.getDate(),
                                                last_refresh_time.getHours(), 0, 0);
    if(jellyfish_box.jellyfish.length === 0) {
      // 没有水母，仅更新时间
    } else {
      // 有水母，更新水母
    }
  }

  console.log(`jellyfish_box: ${JSON.stringify(query[0], null, 2)}`);
  return JSON.stringify(query[0], null, 2);
}