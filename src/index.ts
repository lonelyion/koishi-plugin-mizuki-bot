import { Context, Logger, Schema } from 'koishi';
import * as Database from './database';
import { command_jellyfish_box } from './commands/jellyfish_box';
import * as fs from 'fs/promises';
import * as path from 'path';

export const name = 'mizuki-bot';
export const inject = {
  required: ['database', 'http'],
  //optional: ['assets'],
};

const logger = new Logger('mizuki-bot');

declare module 'koishi' {
  interface Events {
    'mizuki/resource_update'(...args: string[]): void
  }
}


export interface Config {
  remote: string,
  compress: boolean,
  reply: boolean,
  at: boolean,
};

export const Config: Schema<Config> = Schema.object({
  remote: Schema.string().role('link').default('https://bot.cdn.mizuki.ink').description('CDN地址'),
  compress: Schema.boolean().default(false).description('是否压缩图片, 启用会使图片质量下降, 大幅提高速度, 体积减小从而减少图片传输时所需的时间, 关闭会提高画面清晰度'),
  reply: Schema.boolean().default(false).description('消息是否回复用户'),
  at: Schema.boolean().default(false).description('消息是否@用户'),
});

export function apply(ctx: Context) {
  // write your plugin here
  const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');
  fs.mkdir(root, { recursive: true });


  ctx.plugin(Database);

  ctx.on('ready', () => {
    const cdn = ctx.config.remote;
    const local_version_file = path.join(root, 'version.txt');
    let local_version = "0";
    //console.log(`local_version_file: ${local_version_file}`);
    fs.readFile(local_version_file)
    .then(content => {
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
        logger.error(`读取服务器版本失败`, err.message);
      });
  });

  ctx.on('mizuki/resource_update', (version: string) => {
    const local_version_file = path.join(root, 'version.txt');
    const cdn = ctx.config.remote;
    ctx.http.get(`${cdn}/list.txt`).then(res => {
      const list = res;
      const files = list.split('\n');
      for (let i = 0; i < files.length; i++) {
        logger.info(`正在下载 ${i + 1} / ${files.length} 个文件`);
        const name = files[i];
        if (name === '') continue;
        const file_path = path.join(root, name);
        const remote = `${cdn}/${name}`;
        //console.log(`file_path: ${file_path}, remote: ${remote}`);
        fs.mkdir(path.dirname(file_path), { recursive: true });
        ctx.http.get(remote, { responseType: 'arraybuffer' }).then(res => {
          // save file to local
          fs.writeFile(file_path, Buffer.from(res));
        });
      }
      fs.writeFile(local_version_file, version, { encoding: 'utf-8' });
      logger.info('更新完成');
    });
  })


  
  
  ctx.command('水母箱')
  .action(async ({ session }) => {
    return await command_jellyfish_box(ctx.config, ctx, session);
  });

  ctx.command('水母箱.抓水母').alias('抓水母').action(async (_, message) => message);
}
