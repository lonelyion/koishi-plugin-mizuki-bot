import { Context } from "koishi"

declare module 'koishi' {
  interface Tables {
    mzk_jellyfish_box: JellyfishBox,
  }
}

export interface Jellyfish {
  jelly_id: string,
  number: number
}

export interface Decoration {
  deco_id: string,
}

export interface JellyfishBox {
  id: number,
  user_id: string,
  platform: string,
  last_catch_time: Date,
  last_refresh_time: Date,
  jellyfish: Jellyfish[],
  decoration: Decoration[],
  salinity: number, //盐度，千分
  temperature: number, //温度，℃
  draw_style: 'normal' | 'other',
}

export const name = 'Database'

export function apply(ctx: Context) {
  // mzk_jellyfish_box
  ctx.model.extend('mzk_jellyfish_box', {
    id: 'unsigned',
    user_id: 'string',
    platform: 'string',
    last_catch_time: 'timestamp',
    last_refresh_time: 'timestamp',
    jellyfish: 'json',
    decoration: 'json',
    salinity: 'double',
    temperature: 'double',
    draw_style: 'string'
  }, { autoInc: true });
}