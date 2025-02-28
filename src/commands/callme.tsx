import { Context, Session } from 'koishi';
import { GetUser } from '../user/user';

export const CommandCallMe = async (ctx: Context, session: Session, newName: string) => {
  try {
    const uid = session.event.user.id;
    const platform = session.platform;
    const user = await GetUser(ctx, uid, platform);

    await ctx.database.set('mzk_user', user.id, {
      nickname: newName
    });

    return `已将你的昵称更新为 ${newName}`;
  } catch (error) {
    return `更新昵称失败，请检查输入的信息。\n错误信息：${error.message}`;
  }
};