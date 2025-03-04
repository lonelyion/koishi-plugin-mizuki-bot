import { Context, Session } from 'koishi';
import { Attendent, CheckCred, GenerateCredByCode, GenerateQRCode, GetBinding, GetOAuthGrantCode, GetScanStatus, GetTokenByScanCode, ValidateHyperGryphByToken } from '../skland/api';
import { GetUser } from '../user/user';

export const CommandSklandLogin = async (ctx: Context, session: Session) => {
  const { scanId, qrData } = await GenerateQRCode();
  const scanMessage = <>
    <p>请使用森空岛APP扫描二维码登录，本二维码有效时间为3分钟</p>
    <p>通过该技术手段，可以以您的身份登录森空岛，请确保信任本Bot再操作！</p>
    <p>为了方便您后续更新数据，本Bot会将您的「森空岛登录凭证」保存到本地存储中。</p>
    <p>本Bot不会采集或存储任何您的其它数据。</p>
    <img src={qrData} />
  </>;
  session.send(scanMessage);

  // 每两秒检查一次
  let waiting = true;
  let scanStatusCode = -2;
  let scanCode: string | null = null;
  const interval = setInterval(async () => {
    const { code, scanCode: tmp } = await GetScanStatus(scanId);

    scanStatusCode = code;
    scanCode = tmp;
    switch(code) {
    case 0: // 获取到扫码凭证了
    case -1:  // 报错了
    case 102: // 二维码已失效
      clearInterval(interval);
      waiting = false;
      break;
    default:  // 100, 101
      break;
    }
  }, 2000);

  while(waiting) {
    await new Promise(resolve => setTimeout(resolve, 1000));
  }

  if(!scanCode) {
    return scanStatusCode === 102 ? 
      '二维码已失效，请重新发送登录指令' : 
      '登录失败(未获取到ScanCode），请尝试重新发送登录指令';
  }

  const token = await GetTokenByScanCode(scanCode);
  if (!token) {
    return '登录失败(未获取到Token),请尝试重新发送登录指令';
  }

  const validateCode = await ValidateHyperGryphByToken(token);
  if(validateCode !== 0) {
    return '登录失败(Token无效),请尝试重新发送登录指令';
  }

  const grantCode = await GetOAuthGrantCode(token);
  if(!grantCode) {
    return '登录失败(未获取到授权代码),请尝试重新发送登录指令';
  }

  const data = await GenerateCredByCode(grantCode.code);
  if(!data) {
    return '登录失败(未获取到Cred),请尝试重新发送登录指令';
  }

  if(!CheckCred(data.cred)) {
    return '登录失败(Cred无效),请尝试重新发送登录指令';
  }

  const user = await GetUser(ctx, session.event.user.id, session.platform);
  await ctx.database.set('mzk_user', user.id, {
    skland_cred: data.cred,
    skland_uid: data.userId,
    skland_token: data.token
  });

  await GetBinding(data.cred, data.token);

  return '登录成功';
};

export const CommandSklandAttendent = async (ctx: Context, session: Session) => {
  const user = await GetUser(ctx, session.event.user.id, session.platform);
  //const uid = user.skland_uid;
  const cred = user.skland_cred;
  const token = user.skland_token;

  const check = await CheckCred(cred);
  if (!check) {
    return '登录失败(Cred无效),请尝试重新发送登录指令';
  }

  const msg = await Attendent(cred, token);

  return msg;
};