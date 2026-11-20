import * as fs from 'fs/promises';
import * as path from 'path';
import { Context } from 'koishi';
import {
  FACTION_NAMES,
  POSITION_NAMES,
  PROFESSION_NAMES,
  SUB_PROFESSION_NAMES
} from './constants';
import { CharacterSkin, CharacterTable } from './types';

export interface OperatorProfile {
  id: string;
  name: string;
  appellation: string;
  rarity: number; // 1 ~ 6（已 +1）
  profession: string;
  professionName: string;
  subProfessionId: string;
  subProfessionName: string;
  position: string;
  positionName: string;
  factionId: string;
  factionName: string;
  allFactionIds: string[];
  tags: string[];
}

let charSkinsCache: CharacterSkin[] | null = null;
let charTableCache: CharacterTable | null = null;
let playableOperatorsCache: OperatorProfile[] | null = null;

export function clearArknightsDataCache() {
  charSkinsCache = null;
  charTableCache = null;
  playableOperatorsCache = null;
}

export async function loadCharacterSkins(ctx: Context): Promise<CharacterSkin[]> {
  if (charSkinsCache && charSkinsCache.length > 0) {
    return charSkinsCache;
  }

  const logger = ctx.logger('mizuki-bot-arknights');
  const filePath = path.join(ctx.baseDir, 'data', 'mizuki-bot', 'arknights', 'gamedata', 'excel', 'skin_table.json');
  try {
    logger.info('加载干员皮肤数据');
    const content = await fs.readFile(filePath, 'utf-8');
    const skinTable = JSON.parse(content) as { charSkins?: Record<string, CharacterSkin> };
    charSkinsCache = Object.values(skinTable.charSkins ?? {}).filter((skin) => skin.charId.startsWith('char_'));
    return charSkinsCache;
  } catch (error) {
    logger.error('加载干员皮肤数据失败', error instanceof Error ? error.message : String(error));
    return [];
  }
}

export async function loadCharacterTable(ctx: Context): Promise<CharacterTable | null> {
  if (charTableCache && Object.keys(charTableCache).length > 0) {
    return charTableCache;
  }

  const logger = ctx.logger('mizuki-bot-arknights');
  const filePath = path.join(ctx.baseDir, 'data', 'mizuki-bot', 'arknights', 'gamedata', 'excel', 'character_table.json');
  try {
    logger.info('加载干员表数据');
    const content = await fs.readFile(filePath, 'utf-8');
    const obj = JSON.parse(content) as Record<string, unknown>;
    charTableCache = Object.fromEntries(
      Object.entries(obj).filter(([key]) => key.startsWith('char_'))
    ) as CharacterTable;
    return charTableCache;
  } catch (error) {
    logger.error('加载干员表数据失败', error instanceof Error ? error.message : String(error));
    return null;
  }
}

export function buildPlayableOperators(table: CharacterTable): OperatorProfile[] {
  const result: OperatorProfile[] = [];
  for (const [id, char] of Object.entries(table)) {
    if (!id.startsWith('char_')) continue;
    if (char.isNotObtainable) continue;
    if (!(char.profession in PROFESSION_NAMES)) continue;

    const allFactionIds = [char.nationId, char.groupId, char.teamId]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
    const primaryFactionId = allFactionIds[0] ?? 'unknown';
    const factionName = FACTION_NAMES[primaryFactionId] ?? (primaryFactionId === 'unknown' ? '未知' : primaryFactionId);

    result.push({
      id,
      name: char.name,
      appellation: char.appellation ?? '',
      rarity: char.rarity + 1,
      profession: char.profession,
      professionName: PROFESSION_NAMES[char.profession] ?? char.profession,
      subProfessionId: char.subProfessionId,
      subProfessionName: SUB_PROFESSION_NAMES[char.subProfessionId] ?? char.subProfessionId,
      position: char.position,
      positionName: POSITION_NAMES[char.position] ?? char.position,
      factionId: primaryFactionId,
      factionName,
      allFactionIds,
      tags: Array.isArray(char.tagList) ? char.tagList : []
    });
  }
  return result;
}

export async function loadPlayableOperators(ctx: Context): Promise<OperatorProfile[]> {
  if (playableOperatorsCache && playableOperatorsCache.length > 0) {
    return playableOperatorsCache;
  }
  const table = await loadCharacterTable(ctx);
  if (!table) return [];
  playableOperatorsCache = buildPlayableOperators(table);
  return playableOperatorsCache;
}
