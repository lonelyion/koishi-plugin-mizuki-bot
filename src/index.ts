import { Context, Logger, Schema } from 'koishi';
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
import { CommandTest } from './commands/test';
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';
export const name = 'mizuki-bot';

export const inject = {
  required: ['database', 'http', 'skia']
  //optional: ['assets'],
};

const logger = new Logger('mizuki-bot');

declare module 'koishi' {
  interface Events {
    'mizuki/resource_update'(...args: string[]): void
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
  test_account: string,
  compress: boolean,
  reply: boolean,
  at: boolean
};

export const Config: Schema<Config> = Schema.object({
  remote: Schema.string().role('link').default('https://bot.cdn.mizuki.ink').description('CDN地址'),
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
      special: Schema.string().role('color').default('#5a96ef').description('SPECIAL'),
    }).description('水母稀有度颜色组'),
  }).description('默认主题'),

  compress: Schema.boolean().default(false).description('是否压缩图片, 启用会使图片质量下降, 大幅提高速度, 体积减小从而减少图片传输时所需的时间, 关闭会提高画面清晰度'),
  reply: Schema.boolean().default(false).description('消息是否回复用户'),
  at: Schema.boolean().default(false).description('消息是否@用户')
});

export function apply(ctx: Context) {
  // write your plugin here
  const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');
  fs.mkdir(root, { recursive: true });


  ctx.plugin(Database);

  ctx.on('ready', () => {
    const cdn = ctx.config.remote;
    const local_version_file = path.join(root, 'version.txt');
    let local_version = '0';
    //console.log(`local_version_file: ${local_version_file}`);
    fs.readFile(local_version_file)
      .then((content) => {
        local_version = content.toString();
      })
      .catch(() => {
        fs.writeFile(local_version_file, '0', { encoding: 'utf-8' });
      });

    ctx.http.get(`${cdn}/version.txt`)
      .then(res => {
        logger.info(`当前本地资源版本： ${local_version}, 最新: ${res}`);
        if ((Number(res) > Number(local_version))) {
          ctx.emit('mizuki/resource_update', res);
        }
      })
      .catch(err => {
        logger.error('读取服务器版本失败', err.message);
      });
  });

  ctx.on('mizuki/resource_update', async (version: string) => {
    const local_version_file = path.join(root, 'version.txt');
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

    await fs.writeFile(local_version_file, version, { encoding: 'utf-8' });
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
      await ctx.database.set('mzk_jellyfish_box', { id: jellyfish_box.id }, {
        jellyfish: jellyfish_box.jellyfish
      });
    }

    logger.info('已更新水母箱数据库');
  });

  ctx.command('水母箱')
    .action(async ({ session }) => {
      logger.info(`test: ${JSON.stringify(session.event)}`);
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


  ctx.command('测试').alias('a').action(async ({ session }) => {
    return await CommandTest(ctx.config, ctx, session);
  });
};
