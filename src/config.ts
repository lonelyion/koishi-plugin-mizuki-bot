import { Schema } from 'koishi';

export interface ThemeConfig {
  backgroundColor: string;
  backgroundTextColor: string;
  boxBackground: string;
  boxOutline: string;
  date: string;
  name: string;
  cardBackground: string;
  jellyName: string;
  jellyIconBackground: string;
  jellyIconBorder: string;
  title: string;
  eventTitle: string;
  eventDescription: string;
  groups: {
    normal: string;
    good: string;
    great: string;
    perfect: string;
    special: string;
  };
}

export interface Config {
  remote: string;
  localResourceDir: string;
  arknightsGameResource: string;
  test_account: string;
  admin_users: string[];
  changelogPath: string;
  broadcast_interval_ms: number;
  theme: ThemeConfig;
}

export const Config: Schema<Config> = Schema.object({
  remote: Schema.string()
    .role('link')
    .default('https://assets.bot.mizuki.ink')
    .description('水母箱资源 CDN 地址'),
  localResourceDir: Schema.string()
    .default('')
    .description('本地水母箱资源目录（开发调试时填写后直接读取本地资源，不从 CDN 下载）'),
  arknightsGameResource: Schema.string()
    .role('link')
    .default('https://gh-proxy.org/https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/refs/heads/main')
    .description('明日方舟游戏资源地址'),
  test_account: Schema.string()
    .default('Alice')
    .description('测试账号的 userId（免抓水母冷却与强制刷新事件）'),
  admin_users: Schema.array(Schema.string())
    .default([])
    .description('管理员 userId 列表（拥有推送更新公告权限；未填写时也兼容 Koishi 3 级以上权限及 test_account）'),
  changelogPath: Schema.string()
    .default('data/mizuki-bot/data/changelog.json')
    .description('更新日志 JSON 文件路径（相对 Koishi 根目录或绝对路径，可直接编辑后预览/推送）'),
  broadcast_interval_ms: Schema.number()
    .min(200)
    .max(30_000)
    .default(2000)
    .description('全群推送更新日志的发送间隔（毫秒），默认 2000ms 以避免触发 QQ 限流'),
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
