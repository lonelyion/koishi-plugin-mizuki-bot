import { Context } from 'koishi';

declare module 'koishi' {
  interface Tables {
    mzk_user: MzkUser;
    mzk_jellyfish_box: JellyfishBox;
    mzk_jellyfish_meta: JellyfishMeta;
    mzk_jellyfish_event_meta: EventMeta;
    mzk_daily_state: MzkDailyState;
  }
}

export interface MzkDailyState {
  user_id: number;
  last_fortune_date: string;
  fortune_seed: number;
  ingredients: number;
  last_feed_date: string;
  feed_count_today: number;
}

export type RarityGroup = 'normal' | 'good' | 'great' | 'perfect' | 'special';

export type DrawStyle = 'normal' | 'pixel';

// 不命名为 User：declare module 'koishi' 内会与 Koishi 内置 User 表冲突
export interface MzkUser {
  id: number;
  platform: string;
  user_id: string;
  nickname: string;
}

export interface Jellyfish {
  id: string;
  number: number;
}

export interface Decoration {
  deco_id: string;
}

export interface JellyfishBox {
  user_id: number;
  last_catch_time: Date;
  last_refresh_time: Date;
  jellyfish: Jellyfish[];
  decoration: Decoration[];
  salinity: number; // 盐度，千分比
  temperature: number; // 温度，℃
  draw_style: DrawStyle;
}

export interface JellyfishMeta {
  id: string;
  name: string;
  group: string;
  description: string;
  reproductive_rate: number;
  living_location: string[];
  protected: boolean;
  draw: {
    size: number;
    bounce: boolean;
    speed: 'slow' | 'normal' | 'fast';
  };
}

export interface EventMeta {
  id: string;
  name: string;
  description: string;
  type: string;
  probability: number;
  relation: {
    jellyfish: string[];
    medal: string[];
  };
}

export const name = 'mizuki-database';

export function apply(ctx: Context) {
  ctx.model.extend('mzk_user', {
    id: 'unsigned',
    platform: 'string',
    user_id: 'string',
    nickname: { type: 'string', initial: '' }
  }, {
    primary: 'id',
    autoInc: true,
    unique: [['platform', 'user_id']]
  });

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
    foreign: {
      user_id: ['mzk_user', 'id']
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
  }, {
    primary: 'id'
  });

  ctx.model.extend('mzk_jellyfish_event_meta', {
    id: 'string',
    name: 'string',
    description: 'string',
    type: 'string',
    probability: 'double',
    relation: 'json'
  }, {
    primary: 'id'
  });

  ctx.model.extend('mzk_daily_state', {
    user_id: 'unsigned',
    last_fortune_date: { type: 'string', initial: '' },
    fortune_seed: { type: 'unsigned', initial: 0 },
    ingredients: { type: 'unsigned', initial: 0 },
    last_feed_date: { type: 'string', initial: '' },
    feed_count_today: { type: 'unsigned', initial: 0 }
  }, {
    primary: 'user_id',
    foreign: {
      user_id: ['mzk_user', 'id']
    }
  });
}
