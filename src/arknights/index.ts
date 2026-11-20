import * as fs from 'fs/promises';
import * as path from 'path';
import { Context, h, Session } from 'koishi';
import { Config } from '../config';
import { randomChoice, randomInt } from '../utils/random';
import { resolveSessionUserId } from '../utils/user';
import { PROFESSION_NAMES } from './constants';
import { loadCharacterSkins, loadCharacterTable, loadPlayableOperators } from './data';
import { drawDailyFortune } from './fortune';
import { renderFortuneCard } from './fortune_renderer';
import { cropSkin, renderFullSkinBuffer } from './image';
import { ArknightsCharacter } from './types';
import {
  buildWordleHint,
  findOperatorByQuery,
  formatOperatorSummary,
  WordleDifficulty,
  WordleGameManager
} from './wordle';
import { renderWordleBoard } from './wordle_renderer';

const GUESS_LIMIT = 3;
const TOTAL_TIMEOUT_MS = 90 * 1000;
const HINT_DELAY_MS = 45 * 1000;
const REMINDER_DELAY_MS = 60 * 1000;

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function getChannelKey(session: Session): string {
  return session.cid || `${session.platform}:${session.channelId || session.userId || 'global'}`;
}

function extractPlainText(session: Session): string {
  if (Array.isArray(session.elements) && session.elements.length > 0) {
    return session.elements
      .filter((el) => el.type === 'text')
      .map((el) => String(el.attrs?.content ?? ''))
      .join('')
      .trim();
  }
  return (session.content ?? '').replace(/<[^>]+>/g, '').trim();
}

export function registerArknightsCommands(ctx: Context, config: Config) {
  const wordleManager = new WordleGameManager();
  ctx.on('dispose', () => wordleManager.clearAll());

  const handleWordleGuess = async (session: Session, rawInput: string) => {
    const channelKey = getChannelKey(session);
    const active = wordleManager.getActive(channelKey);
    if (!active) {
      return '当前频道没有正在进行的干员推理，发送「猜干员」开启新一局吧！';
    }

    const input = rawInput.trim();
    if (input === '投降' || input === '结束' || input === '不知道' || input.toLowerCase() === 'bzd') {
      const ended = wordleManager.surrender(channelKey);
      if (!ended) return '本局已结束';
      const board = await renderWordleBoard(ctx, config, ended);
      return [h.image(board, 'image/png'), `已提前结束本局，正确答案是：${formatOperatorSummary(ended.target)}`];
    }

    if (input === '提示' || input.toLowerCase() === 'hint') {
      active.hintUsed = true;
      active.updatedAt = Date.now();
      return buildWordleHint(active.target);
    }

    const operators = await loadPlayableOperators(ctx);
    const matched = findOperatorByQuery(operators, input);
    if (!matched) {
      return `没有找到名为「${input}」的干员，请检查干员全称或英文代号后再试~`;
    }

    const res = wordleManager.submitGuess(channelKey, matched);
    if (!res.ok) return res.reason;

    const board = await renderWordleBoard(ctx, config, res.game);
    if (res.game.status === 'won') {
      return [
        h.image(board, 'image/png'),
        `恭喜博士第 ${res.game.guesses.length} 次推理成功！目标干员正是 ${formatOperatorSummary(res.game.target)}`
      ];
    }
    if (res.game.status === 'lost') {
      return [
        h.image(board, 'image/png'),
        `8 次机会用完啦！正确答案是：${formatOperatorSummary(res.game.target)}`
      ];
    }
    return h.image(board, 'image/png');
  };

  // 全量群消息 / 私聊直猜中间件：仅在当前频道存在活跃 Wordle 对局时生效，普通聊天原样放行
  ctx.middleware(async (session, next) => {
    const channelKey = getChannelKey(session);
    const active = wordleManager.getActive(channelKey);
    if (!active) return next();

    const text = extractPlainText(session);
    if (!text || text.startsWith('/') || text.startsWith('猜干员') || text.startsWith('猜 ')) {
      return next();
    }

    if (text === '投降' || text === '不知道' || text.toLowerCase() === 'bzd' || text === '提示') {
      return await handleWordleGuess(session, text);
    }

    const operators = await loadPlayableOperators(ctx);
    const matched = findOperatorByQuery(operators, text);
    if (!matched) {
      return next();
    }

    return await handleWordleGuess(session, text);
  });

  // 1. 干员 Wordle（属性推理猜干员）
  ctx.command('猜干员 [action:text]', '开启或参与明日方舟干员属性推理（Wordle）')
    .alias('干员猜谜', '方舟猜谜', 'wordle')
    .option('six', '-s 仅从六星干员中抽取题目')
    .option('hard', '-H 困难模式（包含 1~3 星干员）')
    .usage('开局后直接发送干员名即可全群协作推理（未开全量消息的群请用「猜 <干员名>」），发送「提示」看线索、「投降」揭晓答案')
    .example('猜干员')
    .example('猜干员 -s')
    .example('猜 水月')
    .action(async ({ session, options }, action) => {
      if (!session) return '无法获取会话信息，请稍后再试';

      const channelKey = getChannelKey(session);
      const trimmed = (action ?? '').trim();

      if (trimmed) {
        return await handleWordleGuess(session, trimmed);
      }

      const existing = wordleManager.getActive(channelKey);
      if (existing) {
        const board = await renderWordleBoard(ctx, config, existing);
        return [
          h.image(board, 'image/png'),
          `当前频道已有进行中的干员推理（${existing.guesses.length}/${existing.maxGuesses}），直接发送干员名或「猜 <干员名>」继续，发送「投降」可揭晓答案~`
        ];
      }

      const operators = await loadPlayableOperators(ctx);
      if (operators.length === 0) {
        return '干员数据尚未加载完成，请稍后再试';
      }

      const difficulty: WordleDifficulty = options?.six ? 'six' : options?.hard ? 'hard' : 'normal';
      const game = wordleManager.start(channelKey, operators, difficulty);
      const modeText = difficulty === 'six'
        ? '六星专场'
        : difficulty === 'hard'
          ? '全星级困难模式'
          : '4~6星标准模式';

      const board = await renderWordleBoard(ctx, config, game);
      return [
        h.image(board, 'image/png'),
        `干员属性推理已开始（${modeText}，共 ${game.maxGuesses} 次机会）！\n直接发送干员名（或「猜 <干员名>」）开始推理，发送「提示」获取线索、「投降」揭晓答案~`
      ];
    });

  ctx.command('猜 <name:text>', '在当前干员推理对局中提交猜测')
    .action(async ({ session }, name) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      if (!name?.trim()) return '请提供干员名称，例如：猜 水月';
      return await handleWordleGuess(session, name);
    });

  // 2. 水月深海运势签
  ctx.command('今日运势', '抽取今日水月深海运势签，并领取深海厨房食材')
    .alias('运势', '水月运势', '抽签')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';
      const uid = resolveSessionUserId(session);
      if (!uid) return '无法获取你的用户信息，请稍后再试';

      const result = await drawDailyFortune(ctx, uid, session.platform);
      const buffer = await renderFortuneCard({
        ctx,
        config,
        session,
        result
      });
      return h.image(buffer, 'image/png');
    });

  // 3. 看局部立绘猜干员
  ctx.command('猜干员.立绘', '看立绘局部猜明日方舟干员')
    .alias('立绘猜干员')
    .action(async ({ session }) => {
      if (!session) return '无法获取会话信息，请稍后再试';

      const logger = ctx.logger('mizuki-bot-arknights');
      const [skins, chars] = await Promise.all([
        loadCharacterSkins(ctx),
        loadCharacterTable(ctx)
      ]);

      if (!skins.length || !chars) {
        return '题库尚未加载完成，请稍后再试';
      }

      const skin = randomChoice(skins);
      const char: ArknightsCharacter | undefined = chars[skin.charId];
      if (!char) {
        return '题库数据异常，请稍后再试';
      }

      const skinFileName = `${skin.portraitId}b.png`;
      const baseUrl = config.arknightsGameResource.replace(/\/+$/, '');
      const skinUrl = `${baseUrl}/skin/${encodeURIComponent(skinFileName)}`;
      const filePath = path.join(ctx.baseDir, 'data', 'mizuki-bot', 'arknights', 'skin', skinFileName);

      await session.send('正在准备题目，图片发送后你将有三次机会回答');

      if (!(await fileExists(filePath))) {
        logger.info(`下载干员立绘：${skinUrl}`);
        try {
          const data = await ctx.http.get(skinUrl, {
            responseType: 'arraybuffer',
            timeout: 20_000
          });
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, Buffer.from(data));
        } catch (error) {
          logger.error('下载干员立绘失败', error instanceof Error ? error.message : String(error));
          return '立绘资源下载失败，请稍后再试';
        }
      }

      const croppedCanvas = await cropSkin(ctx, filePath, randomInt(10, 15));
      const croppedBuffer = await croppedCanvas.toBuffer('png');
      await session.send([
        h.image(croppedBuffer, 'image/png'),
        '博士，这是哪位干员的立绘呢？直接发送干员名字猜一猜吧！（发送「不知道」可提前揭晓）'
      ]);

      const safeSend = (msg: string) => {
        session.send(msg).catch((err) => {
          logger.warn('发送猜干员提示失败', err instanceof Error ? err.message : String(err));
        });
      };

      const deadline = Date.now() + TOTAL_TIMEOUT_MS;
      const timers: ReturnType<typeof setTimeout>[] = [
        setTimeout(() => {
          const profession = PROFESSION_NAMES[char.profession] ?? char.profession;
          safeSend(`提示：这位干员是 ${char.rarity + 1} 星${profession}干员`);
        }, HINT_DELAY_MS),
        setTimeout(() => {
          safeSend('还有 30 秒钟时间...>.<');
        }, REMINDER_DELAY_MS)
      ];

      let guessCount = 0;
      let won = false;

      try {
        while (guessCount < GUESS_LIMIT && Date.now() < deadline) {
          const remaining = deadline - Date.now();
          const guess = (await session.prompt(Math.min(remaining, TOTAL_TIMEOUT_MS)))?.trim();
          if (!guess) break;

          if (guess === '不知道' || guess.toLowerCase() === 'bzd') {
            break;
          }

          guessCount += 1;
          if (guess === char.name || guess.toLowerCase() === char.appellation.toLowerCase()) {
            won = true;
            break;
          }

          if (guessCount < GUESS_LIMIT) {
            await session.send(`回答错误！还有 ${GUESS_LIMIT - guessCount} 次机会`);
          }
        }
      } finally {
        for (const timer of timers) {
          clearTimeout(timer);
        }
      }

      const fullBuffer = await renderFullSkinBuffer(ctx, filePath);
      const skinGroupName = skin.displaySkin.skinGroupName;
      const resultText = won
        ? `恭喜博士回答正确！这是 ${char.name} 的「${skinGroupName}」皮肤`
        : `杂鱼博士没有猜到，正确答案是 ${char.name}（${skinGroupName}）`;

      return [h.image(fullBuffer, 'image/png'), resultText];
    });
}
