export interface CharacterSkin {
  skinId: string;
  charId: string;
  tokenSkinMap: unknown[];
  illustId: string;
  dynIllustId: string | null;
  avatarId: string;
  portraitId: string;
  dynPortraitId: string | null;
  dynEntranceId: string | null;
  buildingId: string | null;
  battleSkin: {
    overwritePrefab: boolean;
    skinOrPrefabId: string;
  };
  isBuySkin: boolean;
  tmplId: string | null;
  voiceId: string | null;
  voiceType: number;
  displaySkin: {
    skinName: string | null;
    colorList: string[];
    titleList: string[];
    modelName: string;
    drawerList: string[];
    designerList: string[];
    skinGroupId: string;
    skinGroupName: string;
    skinGroupSortIndex: number;
    content: string;
    dialog: string | null;
    usage: string | null;
    description: string | null;
    obtainApproach: string | null;
    sortId: number;
    displayTagId: string | null;
    getTime: number;
    onYear: number;
    onPeriod: number;
  };
};

export interface CharacterTable {
  [key: string]: ArknightsCharacter;
}

export interface ArknightsCharacter {
  name: string;
  description: string;
  canUseGeneralPotentialItem: boolean;
  canUseActivityPotentialItem: boolean;
  potentialItemId: string;
  activityPotentialItemId: string | null;
  classicPotentialItemId: string | null;
  nationId: string;
  groupId: string | null;
  teamId: string | null;
  displayNumber: string;
  appellation: string;
  position: string;
  tagList: string[];
  itemUsage: string;
  itemDesc: string;
  itemObtainApproach: string;
  isNotObtainable: boolean;
  isSpChar: boolean;
  maxPotentialLevel: number;
  rarity: number;
  profession: string;
  subProfessionId: string;
  trait: Trait;
  phases: Phase[];
  skills: Skill[];
  displayTokenDict: Record<string, unknown>;
  talents: Talent[];
  potentialRanks: PotentialRank[];
  favorKeyFrames: FavorKeyFrame[];
  allSkillLvlup: SkillLevelUp[];
}

interface Trait {
  candidates: TraitCandidate[];
}

interface TraitCandidate {
  unlockCondition: UnlockCondition;
  requiredPotentialRank: number;
  blackboard: Blackboard[];
  overrideDescripton: string | null;
  prefabKey: string | null;
  rangeId: string | null;
}

interface UnlockCondition {
  phase: number;
  level: number;
}

interface Blackboard {
  key: string;
  value: number;
  valueStr: string | null;
}

interface Phase {
  characterPrefabKey: string;
  rangeId: string;
  maxLevel: number;
  attributesKeyFrames: AttributesKeyFrame[];
  evolveCost: Cost[];
}

interface AttributesKeyFrame {
  level: number;
  data: Attributes;
}

interface Attributes {
  maxHp: number;
  atk: number;
  def: number;
  magicResistance: number;
  cost: number;
  blockCnt: number;
  moveSpeed: number;
  attackSpeed: number;
  baseAttackTime: number;
  respawnTime: number;
  hpRecoveryPerSec: number;
  spRecoveryPerSec: number;
  maxDeployCount: number;
  maxDeckStackCnt: number;
  tauntLevel: number;
  massLevel: number;
  baseForceLevel: number;
  stunImmune: boolean;
  silenceImmune: boolean;
  sleepImmune: boolean;
  frozenImmune: boolean;
  levitateImmune: boolean;
  disarmedCombatImmune: boolean;
  fearedImmune: boolean;
}

interface Cost {
  id: string;
  count: number;
  type: string;
}

interface Skill {
  skillId: string;
  overridePrefabKey: string | null;
  overrideTokenKey: string | null;
  levelUpCostCond: LevelUpCostCond[];
  unlockCond: UnlockCondition;
}

interface LevelUpCostCond {
  unlockCond: UnlockCondition;
  lvlUpTime: number;
  levelUpCost: Cost[];
}

interface Talent {
  candidates: TalentCandidate[];
}

interface TalentCandidate {
  unlockCondition: UnlockCondition;
  requiredPotentialRank: number;
  prefabKey: string;
  name: string;
  description: string;
  rangeId: string | null;
  blackboard: Blackboard[];
  tokenKey: string | null;
  isHideTalent: boolean;
}

interface PotentialRank {
  type: number;
  description: string;
  buff: Buff | null;
  equivalentCost: Cost[];
}

interface Buff {
  attributes: BuffAttributes;
}

interface BuffAttributes {
  abnormalFlags: unknown[];
  abnormalImmunes: unknown[];
  abnormalAntis: unknown[];
  abnormalCombos: unknown[];
  abnormalComboImmunes: unknown[];
  attributeModifiers: AttributeModifier[];
}

interface AttributeModifier {
  attributeType: number;
  formulaItem: number;
  value: number;
  loadFromBlackboard: boolean;
  fetchBaseValueFromSourceEntity: boolean;
}

interface FavorKeyFrame {
  level: number;
  data: Attributes;
}

interface SkillLevelUp {
  unlockCond: UnlockCondition;
  lvlUpCost: Cost[];
}