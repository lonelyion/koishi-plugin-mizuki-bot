import * as fs from 'fs/promises';
import * as path from 'path';
import { Context, Session } from 'koishi';
import type { Image } from '@ltxhhz/koishi-plugin-skia-canvas';
import { Config } from '../config';
import { assetCache } from '../jellyfish/renderer';
import { getOrCreateUser, resolveDisplayName, resolveSessionUserId } from '../utils/user';
import { DrawFortuneResult } from './fortune';
import {
  AK_PALETTE,
  drawArknightsBackground,
  drawBarcode,
  drawChamferBox,
  drawCornerBrackets,
  drawHazardStripes,
  drawRhodesDiamond,
  drawSegmentedBar,
  fitText,
  traceChamferRect,
  wrapLines
} from './ui_primitives';

const CARD_WIDTH = 780;
const CARD_HEIGHT = 876;
const PAD_X = 36;

function resolveResourceRoot(ctx: Context, config: Config): string {
  const localDir = config.localResourceDir?.trim();
  return localDir ? path.resolve(ctx.baseDir, localDir) : path.join(ctx.baseDir, 'data', 'mizuki-bot');
}

async function loadAvatarSafe(ctx: Context, avatarUrl: string | undefined, fallbackPath: string): Promise<Image | null> {
  if (avatarUrl) {
    try {
      if (avatarUrl.startsWith('http://') || avatarUrl.startsWith('https://')) {
        const buf = await ctx.http.get(avatarUrl, { responseType: 'arraybuffer', timeout: 5000 });
        return await ctx.skia.loadImage(Buffer.from(buf));
      }
      return await ctx.skia.loadImage(avatarUrl);
    } catch {
      // 回退默认头像
    }
  }
  try {
    return await assetCache.getThemeImage(ctx, fallbackPath);
  } catch {
    return null;
  }
}

async function loadOperatorAvatar(
  ctx: Context,
  config: Config,
  avatarId: string,
  fallbackCharId: string
): Promise<Image | null> {
  const candidates = avatarId === fallbackCharId ? [avatarId] : [avatarId, fallbackCharId];
  const avatarDir = path.join(ctx.baseDir, 'data', 'mizuki-bot', 'arknights', 'avatar');
  const baseUrl = config.arknightsGameResource.replace(/\/+$/, '');

  for (const id of candidates) {
    const fileName = `${id}.png`;
    const localPath = path.join(avatarDir, fileName);
    try {
      await fs.access(localPath);
      return await ctx.skia.loadImage(localPath);
    } catch {
      // 本地尚未缓存，尝试从游戏资源库下载并落盘缓存
    }

    if (!ctx.http) continue;
    try {
      const url = `${baseUrl}/avatar/${encodeURIComponent(fileName)}`;
      const data = await ctx.http.get(url, { responseType: 'arraybuffer', timeout: 10_000 });
      const buf = Buffer.from(data);
      await fs.mkdir(avatarDir, { recursive: true });
      await fs.writeFile(localPath, buf);
      return await ctx.skia.loadImage(buf);
    } catch {
      // 尝试回退默认头像 ID
    }
  }

  return null;
}

export async function renderFortuneCard(params: {
  ctx: Context;
  config: Config;
  session: Session;
  result: DrawFortuneResult;
}): Promise<Buffer> {
  const { ctx: koishiCtx, config, session, result } = params;
  const { fortune } = result;
  const { Canvas } = koishiCtx.skia;

  const root = resolveResourceRoot(koishiCtx, config);
  const fontRoot = path.join(root, 'font');
  const fallbackAvatar = path.join(root, 'image', 'theme', 'default', 'default_avatar.png');

  try {
    assetCache.ensureFonts(koishiCtx, fontRoot);
  } catch {
    // 字体尚未下载时允许回退系统字体
  }

  const uid = resolveSessionUserId(session);
  const user = uid ? await getOrCreateUser(koishiCtx, uid, session.platform) : undefined;
  const displayName = resolveDisplayName(user, session);
  const [avatar, guardianAvatar] = await Promise.all([
    loadAvatarSafe(koishiCtx, session.event.user?.avatar, fallbackAvatar),
    loadOperatorAvatar(koishiCtx, config, fortune.guardian.avatarId, fortune.guardian.charId)
  ]);

  const canvas = new Canvas(CARD_WIDTH, CARD_HEIGHT);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';

  const accent = fortune.tier.accentColor;
  const innerW = CARD_WIDTH - PAD_X * 2;

  // 1. 明日方舟 PRTS 暗黑工业底 + 细网格 + 水月集成战略水印
  drawArknightsBackground(ctx, CARD_WIDTH, CARD_HEIGHT, 'CAERULA');

  // 顶部系统状态条
  ctx.fillStyle = '#0c0e11';
  ctx.fillRect(0, 0, CARD_WIDTH, 30);
  ctx.fillStyle = accent;
  ctx.fillRect(0, 0, 148, 30);
  drawHazardStripes(ctx, 154, 5, 76, 20, 'rgba(255, 255, 255, 0.25)', 10, 3);

  ctx.fillStyle = '#0c0e11';
  ctx.font = '14px noto-sans-sc-bold';
  ctx.textAlign = 'center';
  ctx.fillText('PRTS // FORTUNE', 74, 20);

  ctx.fillStyle = AK_PALETTE.textMuted;
  ctx.font = '13px noto-sans-sc-medium';
  ctx.textAlign = 'left';
  ctx.fillText('INTEGRATED STRATEGIES · MIZUKI & CAERULA ARBOR', 244, 20);

  ctx.textAlign = 'right';
  ctx.fillStyle = AK_PALETTE.textSecondary;
  ctx.fillText(fortune.dateKey, CARD_WIDTH - PAD_X, 20);

  // 2. 博士档案头栏（切角方形头像 + 身份标签 + 右侧条码）
  const headerY = 48;
  const avatarSize = 72;
  drawChamferBox(ctx, PAD_X, headerY, avatarSize, avatarSize, { tl: 10, br: 10 }, '#1c2026', accent, 1.5);
  if (avatar) {
    ctx.save();
    traceChamferRect(ctx, PAD_X + 2, headerY + 2, avatarSize - 4, avatarSize - 4, { tl: 8, br: 8 });
    ctx.clip();
    ctx.drawImage(avatar, PAD_X + 2, headerY + 2, avatarSize - 4, avatarSize - 4);
    ctx.restore();
  }

  const nameX = PAD_X + avatarSize + 20;
  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.font = '13px noto-sans-sc-bold';
  ctx.textAlign = 'left';
  ctx.fillText('DOCTOR PROFILE // 每日深海观测报告', nameX, headerY + 20);

  ctx.fillStyle = AK_PALETTE.textPrimary;
  ctx.font = '30px noto-sans-sc-bold';
  ctx.fillText(fitText(ctx, displayName, 400), nameX, headerY + 58);

  // 右上角战术编码与条形码
  drawBarcode(ctx, CARD_WIDTH - PAD_X - 60, headerY + 12, 22, 'rgba(255, 255, 255, 0.32)');
  ctx.fillStyle = AK_PALETTE.textMuted;
  ctx.font = '12px noto-sans-sc-medium';
  ctx.textAlign = 'right';
  ctx.fillText('NO. MZK-IS3', CARD_WIDTH - PAD_X, headerY + 54);

  // 3. 主运势与灯火值模块（左侧大运势 + 右侧切角工业印章 + 底部 20 段式灯火刻度条）
  const mainY = 140;
  const mainH = 162;
  drawChamferBox(ctx, PAD_X, mainY, innerW, mainH, { tl: 14, br: 14 }, AK_PALETTE.panel, AK_PALETTE.panelBorder, 1.2);
  drawCornerBrackets(ctx, PAD_X + 14, mainY + 10, innerW - 28, mainH - 20, 8, 'rgba(255, 255, 255, 0.2)', 1);

  // 左侧垂直强调条
  ctx.fillStyle = accent;
  ctx.fillRect(PAD_X, mainY + 14, 5, mainH - 28);

  ctx.fillStyle = AK_PALETTE.textMuted;
  ctx.font = '13px noto-sans-sc-bold';
  ctx.textAlign = 'left';
  ctx.fillText('DAILY ASSESSMENT // 今日运势判定', PAD_X + 24, mainY + 32);

  ctx.fillStyle = AK_PALETTE.textPrimary;
  ctx.font = '44px noto-sans-sc-bold';
  ctx.fillText(fortune.tier.title, PAD_X + 24, mainY + 82);

  // 右侧切角运势评级印章
  const stampW = 128;
  const stampH = 66;
  const stampX = CARD_WIDTH - PAD_X - stampW - 22;
  const stampY = mainY + 20;
  drawChamferBox(ctx, stampX, stampY, stampW, stampH, { tl: 10, br: 10 }, accent);
  ctx.fillStyle = '#111317';
  ctx.font = '34px noto-sans-sc-bold';
  ctx.textAlign = 'center';
  ctx.fillText(fortune.tier.badge, stampX + stampW / 2, stampY + 46);

  // 灯火值分段进度条
  const barY = mainY + 122;
  ctx.fillStyle = AK_PALETTE.textSecondary;
  ctx.font = '14px noto-sans-sc-bold';
  ctx.textAlign = 'left';
  ctx.fillText('LIGHT LEVEL // 今日灯火值', PAD_X + 24, barY - 10);

  ctx.fillStyle = accent;
  ctx.font = '18px noto-sans-sc-bold';
  ctx.textAlign = 'right';
  ctx.fillText(`${fortune.lampValue} / 100`, CARD_WIDTH - PAD_X - 24, barY - 9);

  drawSegmentedBar(ctx, PAD_X + 24, barY, innerW - 48, 18, fortune.lampValue, accent, 20);

  // 4. 今日守护干员卡片（干员档案条 + 右侧切角干员头像，随机展示精一/精二/皮肤）
  const opY = 320;
  const opH = 120;
  drawChamferBox(ctx, PAD_X, opY, innerW, opH, { tr: 12, bl: 12 }, AK_PALETTE.panel, AK_PALETTE.panelBorder, 1.2);
  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.fillRect(PAD_X, opY, 4, opH - 12);

  drawRhodesDiamond(ctx, PAD_X + 42, opY + opH / 2, 20, AK_PALETTE.cyan, 1.8);

  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.font = '13px noto-sans-sc-bold';
  ctx.textAlign = 'left';
  ctx.fillText('ASSIGNED OPERATOR // 今日守护干员', PAD_X + 78, opY + 34);

  ctx.fillStyle = AK_PALETTE.textPrimary;
  ctx.font = '32px noto-sans-sc-bold';
  ctx.fillText(fitText(ctx, fortune.guardian.name, 460), PAD_X + 78, opY + 76);

  ctx.fillStyle = AK_PALETTE.textMuted;
  ctx.font = '14px noto-sans-sc-medium';
  ctx.fillText(`OUTFIT // ${fortune.guardian.skinLabel}`, PAD_X + 78, opY + 102);

  // 右侧干员切角头像（精一 / 精二 / 皮肤随机）
  const opAvatarSize = 92;
  const opAvatarX = CARD_WIDTH - PAD_X - opAvatarSize - 16;
  const opAvatarY = opY + (opH - opAvatarSize) / 2;
  if (guardianAvatar) {
    drawChamferBox(ctx, opAvatarX, opAvatarY, opAvatarSize, opAvatarSize, { tl: 10, br: 10 }, '#111419', AK_PALETTE.cyan, 1.8);
    ctx.save();
    traceChamferRect(ctx, opAvatarX + 2, opAvatarY + 2, opAvatarSize - 4, opAvatarSize - 4, { tl: 8, br: 8 });
    ctx.clip();
    ctx.drawImage(guardianAvatar, opAvatarX + 2, opAvatarY + 2, opAvatarSize - 4, opAvatarSize - 4);
    ctx.restore();
    drawCornerBrackets(ctx, opAvatarX - 4, opAvatarY - 4, opAvatarSize + 8, opAvatarSize + 8, 8, 'rgba(34, 187, 255, 0.55)', 1.2);
  } else {
    // 离线兜底：头像下载失败时退回紧凑铭牌
    ctx.font = '18px noto-sans-sc-bold';
    const detailText = fortune.guardian.detail;
    const detailW = ctx.measureText(detailText).width + 28;
    drawChamferBox(
      ctx,
      CARD_WIDTH - PAD_X - detailW - 20,
      opY + 41,
      detailW,
      38,
      { tl: 8, br: 8 },
      '#14171c',
      '#3e4756',
      1.2
    );
    ctx.fillStyle = AK_PALETTE.yellow;
    ctx.textAlign = 'center';
    ctx.fillText(detailText, CARD_WIDTH - PAD_X - detailW / 2 - 20, opY + 67);
  }

  // 5. 今日水月肉鸽藏品卡片（IS3 Relic Archive）
  const relicY = 458;
  const relicH = 132;
  drawChamferBox(ctx, PAD_X, relicY, innerW, relicH, { tl: 12, br: 12 }, AK_PALETTE.panel, AK_PALETTE.panelBorder, 1.2);
  ctx.fillStyle = AK_PALETTE.yellow;
  ctx.fillRect(PAD_X, relicY + 12, 4, relicH - 12);

  ctx.fillStyle = AK_PALETTE.yellow;
  ctx.font = '13px noto-sans-sc-bold';
  ctx.textAlign = 'left';
  ctx.fillText('COLLECTIBLE ARCHIVE // 今日水月藏品', PAD_X + 24, relicY + 30);

  ctx.fillStyle = AK_PALETTE.textPrimary;
  ctx.font = '25px noto-sans-sc-bold';
  ctx.fillText(fortune.relic.name, PAD_X + 24, relicY + 66);

  ctx.fillStyle = AK_PALETTE.textSecondary;
  ctx.font = '19px noto-sans-sc-regular';
  const relicLines = wrapLines(ctx, `“${fortune.relic.comment}”`, innerW - 48, 2);
  relicLines.forEach((line, idx) => {
    ctx.fillText(line, PAD_X + 24, relicY + 98 + idx * 26);
  });

  // 6. 宜 / 忌 战术双栏清单
  const almanacY = 608;
  const almanacH = 144;
  const colGap = 16;
  const colW = (innerW - colGap) / 2;

  // 左：宜 RECOMMENDED
  drawChamferBox(ctx, PAD_X, almanacY, colW, almanacH, { br: 12 }, AK_PALETTE.panel, AK_PALETTE.panelBorder, 1.2);
  ctx.fillStyle = AK_PALETTE.greenBright;
  ctx.fillRect(PAD_X, almanacY, colW, 3);

  drawChamferBox(ctx, PAD_X + 18, almanacY + 18, 38, 28, { br: 6 }, AK_PALETTE.greenBright);
  ctx.fillStyle = '#0f1215';
  ctx.font = '19px noto-sans-sc-bold';
  ctx.textAlign = 'center';
  ctx.fillText('宜', PAD_X + 37, almanacY + 39);

  ctx.fillStyle = AK_PALETTE.greenBright;
  ctx.font = '13px noto-sans-sc-bold';
  ctx.textAlign = 'left';
  ctx.fillText('RECOMMENDED', PAD_X + 66, almanacY + 37);

  ctx.fillStyle = AK_PALETTE.textPrimary;
  ctx.font = '20px noto-sans-sc-medium';
  ctx.fillText(`▸  ${fitText(ctx, fortune.goodThings[0], colW - 50)}`, PAD_X + 20, almanacY + 84);
  ctx.fillText(`▸  ${fitText(ctx, fortune.goodThings[1], colW - 50)}`, PAD_X + 20, almanacY + 118);

  // 右：忌 AVOID
  const rightX = PAD_X + colW + colGap;
  drawChamferBox(ctx, rightX, almanacY, colW, almanacH, { br: 12 }, AK_PALETTE.panel, AK_PALETTE.panelBorder, 1.2);
  ctx.fillStyle = AK_PALETTE.redBright;
  ctx.fillRect(rightX, almanacY, colW, 3);

  drawChamferBox(ctx, rightX + 18, almanacY + 18, 38, 28, { br: 6 }, AK_PALETTE.redBright);
  ctx.fillStyle = '#0f1215';
  ctx.font = '19px noto-sans-sc-bold';
  ctx.textAlign = 'center';
  ctx.fillText('忌', rightX + 37, almanacY + 39);

  ctx.fillStyle = AK_PALETTE.redBright;
  ctx.font = '13px noto-sans-sc-bold';
  ctx.textAlign = 'left';
  ctx.fillText('AVOID', rightX + 66, almanacY + 37);

  ctx.fillStyle = AK_PALETTE.textPrimary;
  ctx.font = '20px noto-sans-sc-medium';
  ctx.fillText(`▸  ${fitText(ctx, fortune.badThings[0], colW - 50)}`, rightX + 20, almanacY + 84);
  ctx.fillText(`▸  ${fitText(ctx, fortune.badThings[1], colW - 50)}`, rightX + 20, almanacY + 118);

  // 7. 底部 PRTS 终端补给回执栏
  const footerY = 770;
  const footerH = 78;
  drawChamferBox(ctx, PAD_X, footerY, innerW, footerH, { tl: 10, br: 10 }, '#0f1115', AK_PALETTE.panelBorder, 1.2);
  drawHazardStripes(ctx, CARD_WIDTH - PAD_X - 72, footerY + 12, 54, footerH - 24, 'rgba(34, 187, 255, 0.22)', 10, 3);

  ctx.fillStyle = AK_PALETTE.cyan;
  ctx.font = '17px noto-sans-sc-bold';
  ctx.textAlign = 'left';
  const rewardLine = result.isFirstToday
    ? `> 补给到账：深海食材 +${result.ingredientsGranted}（现存 ${result.totalIngredients} 份）${result.cooldownReducedMinutes > 0 ? ` · 抓水母冷却 -${result.cooldownReducedMinutes}m` : ''}`
    : `> 今日观测已归档 · 当前持有深海食材 ${result.totalIngredients} 份`;
  ctx.fillText(fitText(ctx, rewardLine, innerW - 104), PAD_X + 18, footerY + 32);

  ctx.fillStyle = AK_PALETTE.textSecondary;
  ctx.font = '15px noto-sans-sc-regular';
  ctx.fillText('> CMD: 发送「投喂 [暖汤|冰沙|秘制]」可让水月为水母箱烹制料理', PAD_X + 18, footerY + 59);

  return canvas.toBuffer('png');
}
