/**
 * 小抄配置 Schema：键名、默认值、旧 localStorage 键迁移与 parse 校验的唯一声明处。
 * 面板 Tab、显示开关、屏蔽项、皮肤、自动任务、山河图、辅助功能等均在此登记。
 */

import type { XiaochaoPanelTabId } from '../ui/panel/panel-model';

export const CONFIG_DOCUMENT_VERSION = 1;
export const CONFIG_STORAGE_KEY = 'XC::config';

export interface PanelPositionConfig {
  left: number;
  top: number;
}

export interface XiaochaoConfig {
  'panel.activeTab': XiaochaoPanelTabId;
  'panel.collapsed': boolean;
  'panel.dockedRight': boolean;
  'panel.position': PanelPositionConfig | null;
  'display.seatUiEnabled': boolean;
  'display.deckHudEnabled': boolean;
  'display.recentCardMode': 'current' | 'player';
  'display.deckRecordEnabled': boolean;
  'display.discardSortMode': 'suit-type-number' | 'type-suit-number' | 'number-suit-type';
  'display.cardLabelsEnabled': boolean;
  'display.countdownEnabled': boolean;
  'rooms.hidePassword': boolean;
  'cards.handSortEnabled': boolean;
  'cards.handSortLockedMode': '' | 'CardType' | 'CardFlower' | 'CardNumber';
  'cards.handSortPosition': { right: number; top: number } | null;
  'block.adWindow': boolean;
  'block.mvpWindow': boolean;
  'block.packageWindow': boolean;
  'block.noticeWindow': boolean;
  'block.laoXianWindow': boolean;
  'block.probWindow': boolean;
  'block.shaEffect': boolean;
  'block.shanEffect': boolean;
  'block.healEffect': boolean;
  'block.jinnangEffect': boolean;
  'block.equipEffect': boolean;
  'block.shakeEffect': boolean;
  'block.skillEffect': boolean;
  'block.selectEffect': boolean;
  'block.selfSkinEffect': boolean;
  'block.killEffect': boolean;
  'block.entranceEffect': boolean;
  'block.otherSkinState': boolean;
  'block.taskRedDot': boolean;
  'block.interactEffect': boolean;
  'block.factionSlogan': boolean;
  'skin.localSkin': boolean;
  'skin.otherLocalSkin': boolean;
  'skin.officialBackground': boolean;
  'skin.skinPaper': boolean;
  'skin.allPaper': boolean;
  'autoTask.enabled': boolean;
  'autoTask.skipTavern': boolean;
  'autoTask.skipMail': boolean;
  'autoTask.skipDailyGeneralBag': boolean;
  'autoTask.skipSignTrialCard': boolean;
  'autoTask.skipDiJiaQuan': boolean;
  'autoTask.skipHuanLeDou': boolean;
  'autoTask.skipFreeBless': boolean;
  'shanhetu.mapEnabled': boolean;
  'shanhetu.hideStory': boolean;
  'shanhetu.autoBattleEnabled': boolean;
  'shanhetu.prioritizeTricks': boolean;
  'assist.extraEnabled': boolean;
  'assist.sunquanEnabled': boolean;
  'assist.peixiuEnabled': boolean;
  'assist.xushaoEnabled': boolean;
  'assist.autoBotEnabled': boolean;
  'assist.autoLogEnabled': boolean;
  'assist.autoHGEnabled': boolean;
  'assist.baiShengEnabled': boolean;
  'assist.autoBotTavernTarget': 'none' | 'dailyGame' | 'dailyWin' | 'weeklyWin';
  'update.dismissedVersion': string;
  /** 浏览器更新完成后记下的脚本版本。微端检查不读这个值。 */
  'update.installedVersion': string;
}

export type XiaochaoConfigKey = keyof XiaochaoConfig;

interface ConfigDefinition<Value> {
  defaultValue: Value;
  previousStorageKey?: string;
  parse(value: unknown): Value | undefined;
}

const booleanDefinition = (
  defaultValue: boolean,
  previousStorageKey?: string
): ConfigDefinition<boolean> => ({
  defaultValue,
  previousStorageKey,
  parse(value) {
    if (typeof value === 'boolean') return value;
    if (value === 'true' || value === '1' || value === 1) return true;
    if (value === 'false' || value === '0' || value === 0) return false;
    return undefined;
  }
});

const PANEL_TAB_LABELS: Record<string, XiaochaoPanelTabId> = {
  cards: 'cards',
  others: 'others',
  shanhetu: 'others',
  tools: 'others',
  settings: 'cards',
  卡牌: 'cards',
  常规: 'cards',
  山河图: 'others',
  配置: 'cards',
  工具: 'others',
  其他: 'others'
};

/** 所有配置键、默认值、旧键迁移和输入校验的唯一声明位置。 */
export const CONFIG_SCHEMA: {
  [Key in XiaochaoConfigKey]: ConfigDefinition<XiaochaoConfig[Key]>;
} = {
  'panel.activeTab': {
    defaultValue: 'cards',
    previousStorageKey: 'XC::mainPanelActiveTab',
    parse: (value) => typeof value === 'string' ? PANEL_TAB_LABELS[value] : undefined
  },
  'panel.collapsed': booleanDefinition(false, 'XC::mainPanelCollapsed'),
  'panel.dockedRight': booleanDefinition(false, 'XC::mainPanelDockedRight'),
  'panel.position': {
    defaultValue: null,
    previousStorageKey: 'XC::mainPanelPosition',
    parse(value) {
      if (value === null) return null;
      if (!value || typeof value !== 'object') return undefined;
      const position = value as Partial<PanelPositionConfig>;
      return Number.isFinite(position.left) && Number.isFinite(position.top)
        ? { left: Number(position.left), top: Number(position.top) }
        : undefined;
    }
  },
  'display.seatUiEnabled': booleanDefinition(true, 'SEAT_UI_SWITCH'),
  'display.deckHudEnabled': booleanDefinition(true),
  'display.recentCardMode': {
    defaultValue: 'current',
    parse: (value) => value === 'current' || value === 'player' ? value : undefined
  },
  'display.deckRecordEnabled': booleanDefinition(true, 'DECK_RECORD_SWITCH'),
  'display.discardSortMode': {
    defaultValue: 'suit-type-number',
    previousStorageKey: 'DISCARD_SORT_MODE',
    parse: (value) => {
      const mode = String(value);
      return [
        'suit-type-number',
        'type-suit-number',
        'number-suit-type'
      ].includes(mode)
        ? mode as XiaochaoConfig['display.discardSortMode']
        : undefined;
    }
  },
  'display.cardLabelsEnabled': booleanDefinition(true, 'CARD_LABEL_SWITCH'),
  'display.countdownEnabled': booleanDefinition(true, 'COUNT_DOWN_SWITCH'),
  'rooms.hidePassword': booleanDefinition(false, 'onlyNoPasswordRoomSwitch'),
  'cards.handSortEnabled': booleanDefinition(true, 'HAND_SORT_SWITCH'),
  'cards.handSortLockedMode': {
    defaultValue: '',
    previousStorageKey: 'XC::handSortLockedMode',
    parse(value) {
      if (value === 'type-suit-number' || value === 'CardType') return 'CardType';
      if (value === 'suit-type-number' || value === 'CardFlower') return 'CardFlower';
      if (value === 'number-suit-type' || value === 'CardNumber') return 'CardNumber';
      if (value === '' || value === null) return '';
      return undefined;
    }
  },
  'cards.handSortPosition': {
    defaultValue: null,
    previousStorageKey: 'XC::handSortPosition',
    parse(value) {
      if (value === null) return null;
      if (!value || typeof value !== 'object') return undefined;
      const position = value as { right?: unknown; top?: unknown };
      const right = Number(position.right);
      const top = Number(position.top);
      if (!Number.isFinite(right) || !Number.isFinite(top) || right < 0 || top < 0) return undefined;
      return { right: Math.min(10000, right), top: Math.min(10000, top) };
    }
  },
  'block.adWindow': booleanDefinition(false, 'SKIP_AD_WINDOW_SWITCH'),
  'block.mvpWindow': booleanDefinition(false, 'SKIP_MVP_WINDOW_SWITCH'),
  'block.packageWindow': booleanDefinition(false, 'SKIP_PACKAGE_WINDOW_SWITCH'),
  'block.noticeWindow': booleanDefinition(false, 'SKIP_NOTICE_WINDOW_SWITCH'),
  'block.laoXianWindow': booleanDefinition(false, 'SKIP_LAOXIAN_WINDOW_SWITCH'),
  'block.probWindow': booleanDefinition(false, 'SKIP_PROB_WINDOW_SWITCH'),
  'block.shaEffect': booleanDefinition(false, 'BLOCK_SHA_EFFECT_SWITCH'),
  'block.shanEffect': booleanDefinition(false, 'BLOCK_SHAN_EFFECT_SWITCH'),
  'block.healEffect': booleanDefinition(false, 'BLOCK_HEAL_EFFECT_SWITCH'),
  'block.jinnangEffect': booleanDefinition(false, 'BLOCK_JINNANG_EFFECT_SWITCH'),
  'block.equipEffect': booleanDefinition(false, 'BLOCK_EQUIP_EFFECT_SWITCH'),
  'block.shakeEffect': booleanDefinition(false, 'BLOCK_SHAKE_EFFECT_SWITCH'),
  'block.skillEffect': booleanDefinition(false, 'BLOCK_SKILL_EFFECT_SWITCH'),
  'block.selectEffect': booleanDefinition(false, 'BLOCK_SELECT_EFFECT_SWITCH'),
  'block.selfSkinEffect': booleanDefinition(false, 'BLOCK_SELF_SKIN_EFFECT_SWITCH'),
  'block.killEffect': booleanDefinition(false, 'BLOCK_KILL_EFFECT_SWITCH'),
  'block.entranceEffect': booleanDefinition(false, 'BLOCK_ENTRANCE_EFFECT_SWITCH'),
  'block.otherSkinState': booleanDefinition(false, 'BLOCK_SKIN_STATE_SWITCH'),
  'block.taskRedDot': booleanDefinition(false, 'RED_DOT_BLOCK_SWITCH'),
  'block.interactEffect': booleanDefinition(false, 'BLOCK_INTERACT_EFFECT_SWITCH'),
  'block.factionSlogan': booleanDefinition(false, 'BLOCK_FACTION_SLOGAN_SWITCH'),
  'skin.localSkin': booleanDefinition(true, 'LOCAL_SKIN_SWITCH'),
  'skin.otherLocalSkin': booleanDefinition(false, 'OTHER_LOCAL_SKIN_SWITCH'),
  'skin.officialBackground': booleanDefinition(true, 'OFFICIAL_BACKGROUND_SWITCH'),
  'skin.skinPaper': booleanDefinition(true, 'SKIN_PAPER_SWITCH'),
  'skin.allPaper': booleanDefinition(false, 'ALL_PAPER_SWITCH'),
  'autoTask.enabled': booleanDefinition(false, 'AUTO_TASK_SWITCH'),
  'autoTask.skipTavern': booleanDefinition(true, 'AUTO_TASK_TAVERN'),
  'autoTask.skipMail': booleanDefinition(true, 'AUTO_TASK_SKIP_MAIL'),
  'autoTask.skipDailyGeneralBag': booleanDefinition(true, 'AUTO_TASK_SKIP_DAILY_WU_JIANG'),
  'autoTask.skipSignTrialCard': booleanDefinition(true, 'AUTO_SIGN_SKIP_SWITCH'),
  'autoTask.skipDiJiaQuan': booleanDefinition(true, 'AUTO_TASK_SKIP_DI_JIA_QUAN'),
  'autoTask.skipHuanLeDou': booleanDefinition(true, 'AUTO_TASK_SKIP_HUAN_LE_DOU'),
  'autoTask.skipFreeBless': booleanDefinition(true),
  'shanhetu.mapEnabled': booleanDefinition(true, 'ROGUE_CITY_SWITCH'),
  'shanhetu.hideStory': booleanDefinition(false, 'ROGUE_STORY_SWITCH'),
  'shanhetu.autoBattleEnabled': booleanDefinition(false),
  'shanhetu.prioritizeTricks': booleanDefinition(false),
  'assist.extraEnabled': booleanDefinition(false, 'EXTRA_ASSIST_SWITCH'),
  'assist.sunquanEnabled': booleanDefinition(true),
  'assist.peixiuEnabled': booleanDefinition(true),
  'assist.xushaoEnabled': booleanDefinition(true),
  'assist.autoBotEnabled': booleanDefinition(false),
  'assist.autoLogEnabled': booleanDefinition(false),
  'assist.autoHGEnabled': booleanDefinition(false),
  'assist.baiShengEnabled': booleanDefinition(false),
  'assist.autoBotTavernTarget': {
    defaultValue: 'none',
    previousStorageKey: 'XC_AUTO_BOT_TAVERN_TARGET',
    parse(value) {
      return value === 'none' || value === 'dailyGame' || value === 'dailyWin' || value === 'weeklyWin'
        ? value
        : undefined;
    }
  },
  'update.dismissedVersion': {
    defaultValue: '',
    parse(value) {
      return typeof value === 'string' ? value : undefined;
    }
  },
  'update.installedVersion': {
    defaultValue: '',
    parse(value) {
      return typeof value === 'string' ? value : undefined;
    }
  }
};

/** 按 schema 生成一份默认配置。 */
export function getDefaultConfig(): XiaochaoConfig {
  return Object.fromEntries(
    Object.entries(CONFIG_SCHEMA).map(([key, definition]) => [key, definition.defaultValue])
  ) as unknown as XiaochaoConfig;
}
