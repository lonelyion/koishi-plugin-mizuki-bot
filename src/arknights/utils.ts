import { promises as fs } from 'fs';
import { Context, Logger } from 'koishi';
import path from 'path';
import { CharacterSkin, CharacterTable } from './types';
import _ from 'lodash';

const logger = new Logger('mizuki-bot-arknights-loader');

let charSkins: CharacterSkin[] = null, charTable: CharacterTable = null;

export const loadCharacterSkins = async (ctx: Context) : Promise<CharacterSkin[]> => {
  if (_.size(charSkins) === 0) {
    logger.info('Loading character skins');
    const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');
    const filePath = path.join(root, 'arknights', 'gamedata/excel/skin_table.json');
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const skinTable = JSON.parse(fileContent);
    charSkins = Object.values<CharacterSkin>(skinTable.charSkins).filter(skin => skin.charId.startsWith('char_'));
  }
  return charSkins;
};

export const loadCharacterTable = async (ctx: Context) => {
  if(_.size(charTable) === 0) {
    logger.info('Loading character table');
    const root = path.join(ctx.baseDir, 'data', 'mizuki-bot');
    const filePath = path.join(root, 'arknights', 'gamedata/excel/character_table.json');
    const fileContent = await fs.readFile(filePath, 'utf-8');
    const obj = JSON.parse(fileContent);
    // only return children with keys starting with 'char_'
    charTable = Object.fromEntries(
      Object.entries(obj).filter(([key]) => key.startsWith('char_'))
    ) as CharacterTable;
  }
  return charTable;
};
