import { Context } from 'koishi';
import { User } from '../database';
import _ from 'lodash';

export const GetUser = async (ctx: Context, id: string, platform: string) : Promise<User> => {
  const user = await ctx.database.get('mzk_user', {
    platform: platform,
    user_id: id
  });

  if (_.size(user) === 0) {
    return await ctx.database.create('mzk_user', {
      platform: platform,
      user_id: id
    });
  }
  return user[0];
};