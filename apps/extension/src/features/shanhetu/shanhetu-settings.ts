/**
 * 山河图设置键与文案：地图透视、隐藏剧情、商店预览等。
 */

import type { XiaochaoConfigKey } from '../../config/config-schema.ts';

export type ShanhetuSwitchKey = XiaochaoConfigKey & `shanhetu.${string}`;

export interface ShanhetuSwitchSetting {
  key: ShanhetuSwitchKey;
  label: string;
  tooltip: string;
}

/** 山河地图开关，默认开。 */
export const SHANHETU_MAP_KEY = 'shanhetu.mapEnabled' satisfies ShanhetuSwitchKey;

/** 隐藏对白开关，默认关。 */
export const SHANHETU_HIDE_STORY_KEY = 'shanhetu.hideStory' satisfies ShanhetuSwitchKey;

/** 山河图战斗内自动出牌，默认关。 */
export const SHANHETU_AUTO_BATTLE_KEY = 'shanhetu.autoBattleEnabled' satisfies ShanhetuSwitchKey;

export const SHANHETU_MAP_SETTING: ShanhetuSwitchSetting = {
  key: SHANHETU_MAP_KEY,
  label: '山河地图',
  tooltip: '小地图上预览城池事件'
};

export const SHANHETU_HIDE_STORY_SETTING: ShanhetuSwitchSetting = {
  key: SHANHETU_HIDE_STORY_KEY,
  label: '隐藏对白',
  tooltip: '山河图场景对白不显示'
};

export const SHANHETU_AUTO_BATTLE_SETTING: ShanhetuSwitchSetting = {
  key: SHANHETU_AUTO_BATTLE_KEY,
  label: '战斗自动攻击',
  tooltip: '仅在山河图战斗内每 250ms 执行一步安全出牌；只攻击能明确识别为敌方的座位'
};

export const SHANHETU_SWITCH_SETTINGS: readonly ShanhetuSwitchSetting[] = [
  SHANHETU_MAP_SETTING,
  SHANHETU_HIDE_STORY_SETTING,
  SHANHETU_AUTO_BATTLE_SETTING
];

/** 打开山河图集市窗口。 */
export const SHANHETU_OPEN_SHOP_LABEL = '打开集市';
export const SHANHETU_OPEN_SHOP_TOOLTIP = '只在山河图里打开集市窗口';

/** 「集市预览」区域标题。 */
export const SHANHETU_SHOP_PREVIEW_LABEL = '集市透视';
export const SHANHETU_SHOP_PREVIEW_TOOLTIP = '根据同步包 shopData.itemId + Rplot 预览集市商品与价格；暂无数据时不显示';
