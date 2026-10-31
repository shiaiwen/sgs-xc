/**
 * 小抄配置 Schema：键名、默认值、旧 localStorage 键迁移与 parse 校验的唯一声明处。
 * 面板 Tab、显示开关、屏蔽项、皮肤、自动任务、山河图、辅助功能等均在此登记。
 */

import type { XiaochaoPanelTabId } from '../ui/panel/panel-model';

/** 持久化文档版本号；读写时不一致会整份按 schema 回写。 */
export const CONFIG_DOCUMENT_VERSION = 1;
/** 账号无关的旧共享键；新数据落在 `XC::config::<accountId>`。 */
export const CONFIG_STORAGE_KEY = 'XC::config';

/** 主面板自由拖拽时的视口坐标（相对左上）。 */
export interface PanelPositionConfig {
  left: number;
  top: number;
}

/** 运行时配置形状；键名与 CONFIG_SCHEMA 一一对应。 */
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
  'autoTask.skipFreeTreasureFlip': boolean;
  'shanhetu.mapEnabled': boolean;
  'shanhetu.hideStory': boolean;
  'assist.extraEnabled': boolean;
  'assist.sunquanEnabled': boolean;
  'assist.peixiuEnabled': boolean;
  'assist.xushaoEnabled': boolean;
  'assist.autoBotEnabled': boolean;
  'assist.autoHGEnabled': boolean;
  'assist.baiShengEnabled': boolean;
  'assist.autoBotTavernTarget': 'none' | 'dailyGame' | 'dailyWin' | 'weeklyWin';
  /** 为 false 时不拉远程版本；油猴为 true 时检测到新版会自动打开脚本安装页。 */
  'update.autoUpdateEnabled': boolean;
}

export type XiaochaoConfigKey = keyof XiaochaoConfig;

/** 单键定义：默认值、可选的旧独立存储键、以及宽松 parse（失败返回 undefined）。 */
interface ConfigDefinition<Value> {
  defaultValue: Value;
  /** 迁移前各自独立的 localStorage/设置键；仅在无账号文档时读取一次。 */
  previousStorageKey?: string;
  parse(value: unknown): Value | undefined;
}

/**
 * 布尔开关工厂。兼容历史里存成字符串/数字的 true/false、'1'/'0'。
 * parse 失败返回 undefined，由存储层回退 defaultValue 并标记需回写。
 */
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

/**
 * 历史 Tab 标识 → 当前两 Tab（cards / others）。
 * 含旧英文 id、已合并的 shanhetu/tools/settings，以及中文标签。
 */
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
  'panel.dockedRight': booleanDefinition(true, 'XC::mainPanelDockedRight'),
  // null = 未自由拖拽，走默认 dock 布局
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
  // —— 局内显示 ——
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
  // —— 手牌整理 ——
  'cards.handSortEnabled': booleanDefinition(true, 'HAND_SORT_SWITCH'),
  // 兼容旧弃牌排序模式字符串与新 CardType/CardFlower/CardNumber 枚举
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
      // 上限防异常大坐标把按钮拖出可视区后难找回
      return { right: Math.min(10000, right), top: Math.min(10000, top) };
    }
  },
  // —— 弹窗 / 特效屏蔽（默认关，由用户显式打开）——
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
  'block.factionSlogan': booleanDefinition(false, 'BLOCK_FACTION_SLOGAN_SWITCH'),
  // —— 皮肤 / 壁纸 ——
  'skin.localSkin': booleanDefinition(true, 'LOCAL_SKIN_SWITCH'),
  'skin.otherLocalSkin': booleanDefinition(false, 'OTHER_LOCAL_SKIN_SWITCH'),
  'skin.officialBackground': booleanDefinition(false, 'OFFICIAL_BACKGROUND_SWITCH'),
  'skin.skinPaper': booleanDefinition(true, 'SKIN_PAPER_SWITCH'),
  'skin.allPaper': booleanDefinition(false, 'ALL_PAPER_SWITCH'),
  // —— 自动任务（skip* 为 true 表示跳过该项）——
  'autoTask.enabled': booleanDefinition(false, 'AUTO_TASK_SWITCH'),
  'autoTask.skipTavern': booleanDefinition(true, 'AUTO_TASK_TAVERN'),
  'autoTask.skipMail': booleanDefinition(true, 'AUTO_TASK_SKIP_MAIL'),
  'autoTask.skipDailyGeneralBag': booleanDefinition(true, 'AUTO_TASK_SKIP_DAILY_WU_JIANG'),
  'autoTask.skipSignTrialCard': booleanDefinition(true, 'AUTO_SIGN_SKIP_SWITCH'),
  'autoTask.skipDiJiaQuan': booleanDefinition(true, 'AUTO_TASK_SKIP_DI_JIA_QUAN'),
  'autoTask.skipHuanLeDou': booleanDefinition(true, 'AUTO_TASK_SKIP_HUAN_LE_DOU'),
  'autoTask.skipFreeBless': booleanDefinition(true),
  'autoTask.skipFreeTreasureFlip': booleanDefinition(true),
  // —— 山河图（旧键名 rogue.*，存储层会改名迁移）——
  'shanhetu.mapEnabled': booleanDefinition(true, 'ROGUE_CITY_SWITCH'),
  'shanhetu.hideStory': booleanDefinition(false, 'ROGUE_STORY_SWITCH'),
  // —— 技能 / 挂机辅助 ——
  'assist.extraEnabled': booleanDefinition(false, 'EXTRA_ASSIST_SWITCH'),
  'assist.sunquanEnabled': booleanDefinition(true),
  'assist.peixiuEnabled': booleanDefinition(true),
  'assist.xushaoEnabled': booleanDefinition(true),
  'assist.autoBotEnabled': booleanDefinition(false),
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
  'update.autoUpdateEnabled': booleanDefinition(true),
};

/** 按 schema 生成一份默认配置。 */
export function getDefaultConfig(): XiaochaoConfig {
  return Object.fromEntries(
    Object.entries(CONFIG_SCHEMA).map(([key, definition]) => [key, definition.defaultValue])
  ) as unknown as XiaochaoConfig;
}
