import { Context } from 'koishi';

declare module 'koishi' {
  interface Tables {
    mzk_user: User,
    mzk_jellyfish_box: JellyfishBox,
    mzk_jellyfish_meta: JellyfishMeta,
    mzk_jellyfish_event_meta: EventMeta
  }
}

export interface User {
  id: number,
  platform: string,
  user_id: string,
  nickname: string,
  skland_cred: string,
  skland_uid: string,
  skland_token: string,
  skland_last_refresh: Date
}

export interface Jellyfish {
  id: string,
  number: number
}

export interface Decoration {
  deco_id: string,  //27
}

export interface JellyfishBox {
  user_id: number,
  last_catch_time: Date,
  last_refresh_time: Date,
  jellyfish: Jellyfish[],
  decoration: Decoration[],
  salinity: number, //盐度，千分
  temperature: number, //温度，℃
  draw_style: 'normal' | 'pixel',
}

export interface JellyfishMeta {
  id: string,
  name: string,
  group: string,
  description: string,
  reproductive_rate: number,
  living_location: string[],
  protected: boolean,
  draw: {
    size: number,
    bounce: boolean,
    speed: 'slow' | 'normal' | 'fast',
  }
}

export interface EventMeta {
  id: string,
  name: string,
  description: string,
  type: string,
  probability: number,
  relation: {
    jellyfish: string[],
    medal: string[],
  }
}

export const name = 'Database';

export function apply(ctx: Context) {
  ctx.model.extend('mzk_user', {
    id: 'unsigned',
    platform: 'string',
    user_id: 'string',
    nickname: 'string',
    skland_cred: 'string',
    skland_uid: 'string',
    skland_token: 'string',
    skland_last_refresh: 'timestamp'
  }, {
    primary: 'id',
    autoInc: true
  });

  // mzk_jellyfish_box
  ctx.model.extend('mzk_jellyfish_box', {
    user_id: 'unsigned',
    last_catch_time: 'timestamp',
    last_refresh_time: 'timestamp',
    jellyfish: 'json',
    decoration: 'json',
    salinity: 'double',
    temperature: 'double',
    draw_style: 'string'
  }, {
    primary: 'user_id',
    autoInc: true,
    foreign: {
      user_id: ['mzk_user', 'entity_id']
    }
  });

  ctx.model.extend('mzk_jellyfish_meta', {
    id: 'string',
    name: 'string',
    group: 'string',
    description: 'string',
    reproductive_rate: 'double',
    living_location: 'json',
    protected: 'boolean',
    draw: 'json'
  });

  ctx.model.extend('mzk_jellyfish_event_meta', {
    id: 'string',
    name: 'string',
    description: 'string',
    type: 'string',
    probability: 'double',
    relation: 'json'
  });
}