import { h } from "koishi";
import * as fs from 'fs/promises';
import * as path from 'path';
import axios from 'axios';

export function get_file(name: string, root: string, remote: string) {
  // 如果文件存在则返回本地文件
  const file_path = path.join(root, name);
  try {
    return fs.readFile(file_path)
  } catch (error) {
    // 如果文件不存在则从服务器下载
    axios.get(`${remote}/${name}`, { responseType: 'arraybuffer' }).then(res => {
      return fs.writeFile(file_path, res.data)
    });
  }
}

// 将messageList转换为Array<Element | string>  用于session.send
export function paresMessageList(list?: Array<Buffer | string>): Array<Element | string> {
  if (!list) {
    return []
  }
  let messageList = []
  for (let i = 0; i < list.length; i++) {
    parseMessage(list[i])
  }
  function parseMessage(message: Buffer | string) {
    if (typeof message == 'string') {
      messageList.push(message)
    }
    else if (message instanceof Buffer) {
      messageList.push(h.image(message, 'image/png'))
    }
  }
  return messageList
}
