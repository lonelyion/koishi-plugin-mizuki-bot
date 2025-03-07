/* eslint-disable @typescript-eslint/no-explicit-any */
import { webcrypto } from 'node:crypto';
//import type { FetchContext } from 'ofetch';
//import { stringifyQuery } from 'ufo';
import pako from 'pako';
import { format } from 'date-fns';
import { BROWSER_ENV, DES_RULE, SKLAND_SM_CONFIG } from './constant';
import { encryptAES, encryptObjectByDESRules, encryptRSA, md5 } from './crypto';
import { GetBinding, GameAttendance } from './api';
import { Logger } from 'koishi';

const crypto = webcrypto;

export const command_header = {
  'User-Agent': 'Skland/1.21.0 (com.hypergryph.skland; build:102100065; iOS 17.6.0; ) Alamofire/5.7.1',
  'Accept-Encoding': 'gzip',
  'Connection': 'close',
  'Content-Type': 'application/json'
};

export const sign_header = {
  platform: '2',
  timestamp: '',
  dId: '',
  vName: '1.21.0'
};

export function getPrivacyName(name: string) {
  return name.split('')
    .map((s, i) => (i > 0 && i < name.length - 1) ? '*' : s)
    .join('');
}

export function getRequestURL(request: RequestInfo, baseURL?: string) {
  const url = typeof request === 'string' ? request : request.url;
  if (URL.canParse(url))
    return new URL(url);
  return new URL(url, baseURL);
}

const stringify = (obj: any) => JSON.stringify(obj).replace(/":"/g, '": "').replace(/","/g, '", "');

export function gzipObject(o: object) {
  const jsonStr = stringify(o);
  const encoded = new TextEncoder().encode(jsonStr);
  const compressed = pako.gzip(encoded, {
    level: 2
  });

  // Python gzip OS FLG = Unknown
  compressed.set([19], 9);

  return btoa(String.fromCharCode(...compressed));
}

export async function getSmId() {
  const now = new Date();
  const _time = format(now, 'yyyyMMddHHmmss');

  // 生成UUID v4
  const uid = crypto.randomUUID();

  // MD5加密uid
  const uidMd5 = md5(uid);

  const v = `${_time + uidMd5}00`;

  // 计算smsk_web
  const smsk_web = (await md5(`smsk_web_${v}`)).substring(0, 14);

  return `${v + smsk_web}0`;
}

export function getTn(o: Record<string, any>) {
  // 获取并排序对象的所有键
  const sortedKeys: string[] = Object.keys(o).sort();

  // 用于存储处理后的值
  const resultList: string[] = [];

  // 遍历排序后的键
  for (const key of sortedKeys) {
    let v: any = o[key];

    // 处理数字类型
    if (typeof v === 'number')
      v = String(v * 10000);

    // 处理对象类型（递归）
    else if (typeof v === 'object' && v !== null)
      v = getTn(v);

    resultList.push(v);
  }

  // 将所有结果连接成字符串
  return resultList.join('');
}

const SM_CONFIG = SKLAND_SM_CONFIG;
const devices_info_url = `${SKLAND_SM_CONFIG.protocol}://${SKLAND_SM_CONFIG.apiHost}${SKLAND_SM_CONFIG.apiPath}`;

export async function getDid() {
  // 生成 UUID 并计算 priId
  const uid = crypto.randomUUID();
  const priId = (await md5(uid)).substring(0, 16);
  const ep = await encryptRSA(uid, SM_CONFIG.publicKey);
  // 准备浏览器环境数据
  const browser = {
    ...BROWSER_ENV,
    vpw: crypto.randomUUID(),
    svm: Date.now(),
    trees: crypto.randomUUID(),
    pmf: Date.now()
  };
  // 准备加密目标数据
  const desTarget: Record<string, string | number> = {
    ...browser,
    protocol: 102,
    organization: SM_CONFIG.organization,
    appId: SM_CONFIG.appId,
    os: 'web',
    version: '3.0.0',
    sdkver: '3.0.0',
    box: '', // 首次请求为空
    rtype: 'all',
    smid: await getSmId(),
    subVersion: '1.0.0',
    time: 0
  };
  // 计算并添加 tn
  desTarget.tn = await md5(getTn(desTarget));
  // DES 加密
  const desResult = await encryptObjectByDESRules(desTarget, DES_RULE);
  // GZIP 压缩
  const gzipResult = gzipObject(desResult);
  // AES 加密
  const aesResult = await encryptAES(gzipResult, priId);
  const body = {
    appId: 'default',
    compress: 2,
    data: aesResult,
    encode: 5,
    ep,
    organization: SM_CONFIG.organization,
    os: 'web'
  };
  // 发送请求
  const response = await fetch(devices_info_url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const resp = await response.json();
  if (resp.code !== 1100) {
    console.log(resp);
    throw new Error('did计算失败，请联系作者');
  }
  return `B${resp.detail.deviceId}`;
}

export const Attendent = async (cred: string, token: string) => {
  const logger = new Logger('mizuki-bot-skland');
  const getPrivacyName = (name: string) => {
    return name.split('')
      .map((s, i) => (i > 0 && i < name.length - 1) ? '*' : s)
      .join('');
  };
  
  try {
    const bindings = await GetBinding(cred, token);
    logger.info(bindings);
    const characters = bindings.data.list.map(i => i.bindingList).flat();
    let successAttendance = 0;
    let allMsg = '【森空岛每日签到】\n';

    for (const character of characters) {
      try {
        const data = await GameAttendance(cred, token, character.uid, character.channelMasterId);
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