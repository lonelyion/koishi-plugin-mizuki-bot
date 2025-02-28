/* eslint-disable @typescript-eslint/no-unused-vars */
// eslint-disable @typescript-eslint/no-unused-vars
import { Session, Context } from 'koishi';
import { GetUser } from '../user/user';
import { Attendent, CheckCred } from '../skland/api';


export const CommandTest = async (ctx: Context, session: Session) => {
  return '测试';
};