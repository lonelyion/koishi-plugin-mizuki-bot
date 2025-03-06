import { Context, Schema } from 'koishi';
import * as Database from './database';
import { 
  CommandJellyfishBox, 
  CommandJellyfishBoxCatch, 
  CommandJellyfishBoxDrop,
  CommandJellyfishBoxStatistics,
  CommandJellyfishBoxCatalogue,
  CommandJellyfishBoxSetStyle
} 
  from './commands/jellyfish_box';
import { CommandTest } from './commands/testCommand';
import * as fs from 'fs/promises';
import * as path from 'path';
//import axios from 'axios';
import { CommandCallMe } from './commands/callme';
import { CommandSklandAttendent, CommandSklandLogin } from './commands/skland';
import {} from 'koishi-plugin-cron';
import { jellyfishBoxUpdate, jellyfishBoxCheck, arknightsDataUpdate, arknightsDataCheck, RefreshUserTokens } from './update';
import { CommandArknightsOperatorGuessSkin } from './commands/arknights';
//import _ from 'lodash';
export const name = 'mizuki-bot';

export const inject = {
  required: ['database', 'cron', 'skia']
  //optional: ['assets'],
};

//const logger = new Logger('mizuki-bot');

declare module 'koishi' {
  interface Events {
    'mizuki/resource_update'(...args: string[]): void,
    'mizuki/arknights_update'(...args: string[]): void
  }
};

export interface Config {
  theme: {
    backgroundColor: string,
    backgroundTextColor: string,
    boxBackground: string,
    boxOutline: string,
    date: string,
    name: string,
    cardBackground: string,
    jellyName: string,
    jellyIconBackground: string,
    jellyIconBorder: string,
    title: string,
    eventTitle: string,
    eventDescription: string,
    groups: {
      normal: string,
      good: string,
      great: string,
      perfect: string,
      special: string
    }
  },
  remote: string,
  arknightsGameResource: string,
  test_account: string
};

export const Config: Schema<Config> = Schema.object({
  remote: Schema.string().role('link').default('https://bot.cdn.mizuki.ink').description('CDN地址'),
  arknightsGameResource: Schema.string().role('link').default('https://gh.miriko.top/https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/refs/heads/main').description('明日方舟游戏资源地址'),
  test_account: Schema.string().default('Alice').description('测试账号的userId'),

  theme: Schema.object({
    backgroundColor: Schema.string().role('color').default('#EAEBEE').description('背景颜色'),
    backgroundTextColor: Schema.string().role('color').default('#D5DADF').description('背景文字颜色'),
    boxBackground: Schema.string().role('color').default('#1b4771').description('水母箱背景颜色'),
    boxOutline: Schema.string().role('color').default('#002237').description('水母箱边框颜色'),
    date: Schema.string().role('color').default('#363739').description('日期颜色'),
    name: Schema.string().role('color').default('#2E82EE').description('用户名颜色'),
    cardBackground: Schema.string().role('color').default('#FFFFFF').description('卡片背景颜色'),
    jellyName: Schema.string().role('color').default('#2E82EE').description('水母名称颜色'),
    jellyIconBackground: Schema.string().role('color').default('#def8ff').description('水母图标背景颜色'),
    jellyIconBorder: Schema.string().role('color').default('#76c9ec').description('水母图标边框颜色'),
    title: Schema.string().role('color').default('#2E82EE').description('标题颜色'),
    eventTitle: Schema.string().role('color').default('#000000').description('事件标题颜色'),
    eventDescription: Schema.string().role('color').default('#333333').description('事件描述颜色'),
    groups: Schema.object({
      normal: Schema.string().role('color').default('#eace5f').description('NORMAL'),
      good: Schema.string().role('color').default('#46eca4').description('GOOD'),
      great: Schema.string().role('color').default('#f15fb2').description('GREAT'),
      perfect: Schema.string().role('color').default('#935ff1').description('PERFECT'),
      special: Schema.string().role('color').default('#5a96ef').description('SPECIAL')
    }).description('水母稀有度颜色组')
  }).description('默认主题')
});

export function apply(ctx: Context) {
  // write your plugin here
  const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');
  fs.mkdir(root, { recursive: true });


  ctx.plugin(Database);


  // 事件
  ctx.on('ready',  () => {
    jellyfishBoxCheck(ctx, root);
    arknightsDataCheck(ctx, root);
  });

  ctx.on('mizuki/resource_update', async (version: string) => {
    jellyfishBoxUpdate(ctx, root, version);
  });

  ctx.on('mizuki/arknights_update', async (version: string) => {
    arknightsDataUpdate(ctx, root, version);
  });

  // 计划任务
  ctx.cron('*/5 * * * *', async () => {
    await RefreshUserTokens(ctx);
  });

  ctx.cron('5 */2 * * *', async () => {
    jellyfishBoxCheck(ctx, root);
    arknightsDataCheck(ctx, root);
  });

  // 指令
  ctx.command('叫我 <name:string>').action(async ({ session }, name) => {
    return await CommandCallMe(ctx, session, name);
  });

  ctx.command('水母箱')
    .action(async ({ session }) => {
      //logger.info(`test: ${JSON.stringify(session.event)}`);
      return await CommandJellyfishBox(ctx.config, ctx, session);
    });

  ctx.command('水母箱.抓水母').alias('抓水母').action(async ({ session }) => {
    return await CommandJellyfishBoxCatch(ctx.config, ctx, session);
  });

  ctx.command('水母箱.统计').alias('水母统计表').action(async ({ session }) => {
    return await CommandJellyfishBoxStatistics(ctx.config, ctx, session);
  });

  ctx.command('水母箱.图鉴').alias('水母图鉴').action(async ({ session }) => {
    return await CommandJellyfishBoxCatalogue(ctx.config, ctx, session);
  });

  ctx.command('水母箱.样式 <style:string>').alias('样式').action(async ({ session }, style) => {
    return await CommandJellyfishBoxSetStyle(ctx.config, ctx, session, style);
  });

  ctx.command('水母箱.放生 <kind:string> [...rest]').alias('放生')
    .usage('请添加水母名称以及数量')
    .example('水母箱 放生 灯塔水母 all')
    .example('水母箱 放生 normal 10')
    .action(async ({ session }, kind , ...rest) => {
      return await CommandJellyfishBoxDrop(ctx.config, ctx, session, [kind, ...rest]);
    });

  
  ctx.command('森空岛.登录').alias('登录').action(async ({ session }) => {
    return await CommandSklandLogin(ctx, session);
  });

  ctx.command('森空岛.签到').alias('森空岛签到').action(async ({ session }) => {
    return await CommandSklandAttendent(ctx, session);
  });

  ctx.command('猜干员.立绘').alias('立绘猜干员').action(async ({ session }) => {
    return await CommandArknightsOperatorGuessSkin(ctx, session);
  });

  ctx.command('测试').alias('a').action(async ({ session }) => {
    return await CommandTest(ctx, session);
  });
};
