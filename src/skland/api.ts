import axios from 'axios';
import { Logger } from 'koishi';
import QRCode from 'qrcode';
import { getDid } from './helper';
import { stringifyQuery } from 'ufo';
import { hmacSha256, md5 } from './crypto';
//import _ from 'lodash';

const logger = new Logger('mizuki-bot-skland');
const appCode = '4ca99fa6b56cc2ba';
const WHITE_LIST = [
  '/web/v1/user/auth/generate_cred_by_code',
  '/api/v1/auth/refresh',
  '/api/v1/user/check'
];

const axiosInstance = axios.create({
  headers: {
    'Content-Type': 'application/json',
    'Origin': 'https://www.skland.com',
    'Referer': 'https://www.skland.com/',
    'Cache-Control': 'no-cache',
    'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64; rv:134.0) Gecko/20100101 Firefox/134.0'
  }
});

axiosInstance.interceptors.request.use(async (config) => {
  const MILLISECOND_PER_SECOND = 1000;
  const { url, headers, data, params } = config;
  // there's no baseURL in config
  const baseURL = url?.split('?')[0]?.split('/').slice(0, 3).join('/');
  //logger.info(`before_config: ${JSON.stringify(config, null ,2)}`);
  if (baseURL !== 'https://zonai.skland.com') return config;
  const pathname = url?.replace(baseURL || '', '') || '';
  //logger.info(`pathname: ${pathname}`);
  if (WHITE_LIST.includes(pathname)) return config;

  const token = headers?.token;
  if (!token) throw new Error('token 不存在');
  const query = params ? stringifyQuery(params) : '';
  const timestamp = (Date.now() - 2 * MILLISECOND_PER_SECOND).toString().slice(0, -3);
  const signatureHeaders = {
    platform: '1',
    timestamp,
    dId: '',
    vName: '1.21.0'
  };
  const str = `${pathname}${query}${data ? JSON.stringify(data) : ''}${timestamp}${JSON.stringify(signatureHeaders)}`;
  const hmacSha256ed = await hmacSha256(token, str);
  const sign = await md5(hmacSha256ed);
  for (const [key, value] of Object.entries(signatureHeaders)) {
    headers.set(key, value);
  }
  headers.set('sign', sign);
  headers.delete('token');
  //logger.info(`after_config: ${JSON.stringify(config, null ,2)}`);
  return config;
}, (error) => {
  return Promise.reject(error);
});

export const GenerateQRCode = async () => {
  // https://as.hypergryph.com/general/v1/gen_scan/login
  const res = await axiosInstance.post('https://as.hypergryph.com/general/v1/gen_scan/login', {
    appCode
  });

  /* res.data
    {
      "data": {
          "scanId": "xxx",
          "scanUrl": "hypergryph://scan_login?scanId=xxx"
      },
      "msg": "OK",
      "status": 0,
      "type": "A"
    }
  */

  const scanUrl = res.data.data.scanUrl;
  const scanId = res.data.data.scanId;

  // 生成二维码
  const qrData = await QRCode.toDataURL(scanUrl, {
    width: 500,
    margin: 0
  });


  return { scanId, qrData };
};

export const GetScanStatus = async (scanId: string) => {
  const scanStatusUrl = `https://as.hypergryph.com/general/v1/scan_status?scanId=${scanId}`;
  try {
    const res = await axiosInstance.get(scanStatusUrl);

    /* res.data
        {"msg":"未扫码","status":100,"type":"A"}
        {"msg":"已扫码待确认","status":101,"type":"A"}
        {"msg":"已失效","status":102,"type":"A"}
        {"data":{"scanCode":"xxx"},"msg":"OK","status":0,"type":"A"}
    */

    return { code: res.data.status, scanCode: res.data?.data?.scanCode || null };
  } catch (error) {
    logger.error(error);
    return { code: -1, scanCode: null };
  }
};

export const GetTokenByScanCode = async (scanCode: string): Promise<string> => {
  const tokenByScanCodeUrl = 'https://as.hypergryph.com/user/auth/v1/token_by_scan_code';
  try {
    const tokenRes = await axiosInstance.post(tokenByScanCodeUrl, {
      scanCode: scanCode
    });

    /* tokenRes.data
      {"data":{"token":"xxx"},"msg":"OK","status":0,"type":"A"}
    */

    return tokenRes.data.data.token;
  } catch (error) {
    logger.error(error);
    return null;
  }
};

export const ValidateHyperGryphByToken = async (token: string) => {
  const url = `https://as.hypergryph.com/user/info/v1/basic?token=${token}`;
  try {
    const validateRes = await axiosInstance.get(url);
    return validateRes.data.status;
  } catch (error) {
    logger.error(`token: ${token}\nerror:${error}`);
    return -1;
  }
};

export const GetOAuthGrantCode = async (token: string) => {
  //当请求成功时，会返回状态码0，以及一个包含授权代码和用户ID的JSON数据。
  const url = 'https://as.hypergryph.com/user/oauth2/v2/grant';
  try {
    const res = await axiosInstance.post(url, {
      token: token,
      appCode: appCode,
      type: 0
    });

    /* res.data
    {
      "status": 0,
      "type": "A",
      "msg": "OK",
      "data": {
          "code": "xxx",
          "uid": "xxx"
      }
    }
    */
    if (res.data.status === 0) {
      return res.data.data;
    } else {
      throw new Error(res.data.msg);
    }

  } catch (error) {
    logger.error(`token: ${token}\nerror:${error}`);
    return null;
  }
};

export const GenerateCredByCode = async (code: string) => {
  const url = 'https://zonai.skland.com/web/v1/user/auth/generate_cred_by_code';
  try {
    const res = await axiosInstance.post(url, {
      code: code,
      kind: 1
    }, {
      headers: {
        dId: await getDid(),
        platform: '3',
        timestamp: `${Math.floor(Date.now() / 1000)}`,
        vName: '1.0.0'
      }
    });

    /* res.data
    {
      "code": 0,
      "message": "OK",
      "data": {
          "cred": "xxx"
          "userId": "xxx",
          "token": "xxx"
      }
    }
    */

    if (res.data.code === 0) {
      return res.data.data;
    } else {
      throw new Error(res.data.message);
    }
  } catch (error) {
    logger.error(`code: ${code}\nerror:${error}`);
    return null;
  }
};

export const CheckCred = async (cred: string) => {
  const url = 'https://zonai.skland.com/api/v1/user/check';
  try {
    const res = await axiosInstance.get(url, {
      headers: {
        cred: cred
      }
    });

    /* res.data
    {
      "code": 0,
      "message": "OK",
      "data": {
          "policyList": [],
          "isNewUser": false
      }
    }
    */

    if (res.data.code === 0) {
      return res.data.data;
    } else {
      throw new Error(res.data.message);
    }
  } catch (error) {
    logger.error(`cred: ${cred}\nerror:${error}`);
    return null;
  }
};

export const RefreshToken = async (cred, token) => {
  try {
    const url = 'https://zonai.skland.com/api/v1/auth/refresh';
    const { data } = await axiosInstance.get(url, {
      headers: {
        Cookie: `SK_OAUTH_CRED_KEY_CK=${cred}`
      }
    });
    //logger.info(`刷新token 响应数据${JSON.stringify(data)} token: ${data.data.token}`);
    return data.data.token;
  } catch (error) {
    logger.error(`刷新token: ${token}\nerror:${error}`);
    return null;
  };
};

/**
 * 通过登录凭证和森空岛用户的 token 获取角色绑定列表
 * @param cred 鹰角网络通行证账号的登录凭证
 * @param token 森空岛用户的 token
 */
export const GetBinding = async (cred: string, token: string) => {
  const url = 'https://zonai.skland.com/api/v1/game/player/binding';
  try {
    const res = await axiosInstance.get(url, {
      headers: {
        cred,
        token
      }
    });

    return res.data;
  } catch (error) {
    logger.error(`cred: ${cred} token: ${token}\nerror:${error}`);
    return error.message;
  }
};

export const Attendent = async (cred: string, token: string) => {
  const getPrivacyName = (name: string) => {
    return name.split('')
      .map((s, i) => (i > 0 && i < name.length - 1) ? '*' : s)
      .join('');
  };
  const attendance = async (uid, gameId) => {
    const url = 'https://zonai.skland.com/api/v1/game/attendance';
    const { data: record } = await axiosInstance.get(url, {
      headers: {
        token,
        cred
      },
      params: {
        uid: uid,
        gameId: gameId
      }
    });

    const todayAttended = record.data.records.find((i) => {
      const today = new Date().setHours(0, 0, 0, 0);
      return new Date(Number(i.ts) * 1000).setHours(0, 0, 0, 0) === today;
    });

    if (todayAttended) {
      return false;
    } else {
      //logger.info(`这里是一条测试 ${token} ${cred}`);
      const { data } = await axiosInstance.post(url, {
        uid,
        gameId
      }, {
        headers: {
          token,
          cred,
          'Content-Type': 'application/json'
        }
      });
      //logger.info(`测试：${JSON.stringify(data)}`);
      return data;
    }
  };
  try {
    const bindings = await GetBinding(cred, token);
    //logger.info(bindings);
    const characters = bindings.data.list.map(i => i.bindingList).flat();
    let successAttendance = 0;
    let allMsg = '【森空岛每日签到】\n';

    for(const character of characters) {
      try {
        const data = await attendance(character.uid, character.channelMasterId);
        if (data) {
          if (data.code === 0 && data.message === 'OK') {
            const msg = `${(Number(character.channelMasterId) - 1) ? 'B 服' : '官服'}角色 ${getPrivacyName(character.nickName)} 签到成功${`, 获得了${data.data.awards.map(a => `「${a.resource.name}」${a.count}个`).join(',')}`}`;
            allMsg += `${msg}\n`;
            successAttendance++;
          }
          else {
            const msg = `${(Number(character.channelMasterId) - 1) ? 'B 服' : '官服'}角色 ${getPrivacyName(character.nickName)} 签到失败${`, 错误消息: ${data.message}\n\n\`\`\`json\n${JSON.stringify(data, null, 2)}\n\`\`\``}`;
            allMsg += `${msg}\n`;
          }
        }
        else {
          const msg = `${(Number(character.channelMasterId) - 1) ? 'B 服' : '官服'}角色 ${getPrivacyName(character.nickName)} 今天已经签到过了`;
          allMsg += `${msg}\n`;
        }
      }
      catch (error) {
        if (error.response && error.response.status === 403) {
          allMsg += `${(Number(character.channelMasterId) - 1) ? 'B 服' : '官服'}角色 ${getPrivacyName(character.nickName)} 今天已经签到过了\n`;
        }
        else {
          allMsg += `签到过程中出现未知错误: ${error.message}\n`;
          logger.error(`签到过程中出现未知错误: ${error.message}\n${error.stack}`);
          return;
        }
      }
    };

    if (successAttendance !== 0) {
      allMsg += `成功签到 ${successAttendance} 个角色`;
    } else {
      allMsg += '今天已经签到过了';
    }

    return allMsg;

  } catch (error) {
    logger.error(`每日签到 error:${error}`);
    return error.message;
  }
};