import { h } from "koishi";

// 将messageList转换为Array<Element | string>  用于session.send
// from https://github.com/Yamamoto-2/tsugu-bangdream-bot
export function paresMessageList(list?: Array<Buffer | string>): Array<Element | string> {
  if (!list) {
    return []
  }
  const messageList = []
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
