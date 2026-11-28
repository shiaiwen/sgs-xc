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

/** 地图与集市缺数据时请求完整山河同步；0x3f 是游戏原版 dataMark 掩码。 */
export const ROGUE_SHOP_DATA_REQ_MARK = 0x3f;

/** 隐藏对白开关，默认关。 */
export const SHANHETU_HIDE_STORY_KEY = 'shanhetu.hideStory' satisfies ShanhetuSwitchKey;

/** 山河图对局自动放弃使用无懈。 */
export const SHANHETU_AUTO_CANCEL_WUXIE_KEY = 'shanhetu.autoCancelWuxie' satisfies ShanhetuSwitchKey;

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

export const SHANHETU_AUTO_CANCEL_WUXIE_SETTING: ShanhetuSwitchSetting = {
  key: SHANHETU_AUTO_CANCEL_WUXIE_KEY,
  label: '自动取消无懈',
  tooltip: '山河图对局中，询问是否无懈时自动点取消\n自己和别人打出的锦囊都会跳过'
};

export const SHANHETU_SWITCH_SETTINGS: readonly ShanhetuSwitchSetting[] = [
  SHANHETU_MAP_SETTING,
  SHANHETU_HIDE_STORY_SETTING
  // 功能尚未开发完成，暂不展示开关。
  // SHANHETU_AUTO_CANCEL_WUXIE_SETTING
];

/** 打开山河图集市窗口。 */
export const SHANHETU_OPEN_SHOP_LABEL = '打开集市';
export const SHANHETU_OPEN_SHOP_TOOLTIP = '只在山河图里打开集市窗口';

/** 「集市预览」区域标题。 */
export const SHANHETU_SHOP_PREVIEW_LABEL = '集市透视';
export const SHANHETU_SHOP_PREVIEW_TOOLTIP = '进山河图后自动拉取 shopData，无需先打开游戏内集市；商品名来自山河配置表 Rplot';

export const SHANHETU_SHOP_PREVIEW_EMPTY_HINT = '暂无商品列表：请在山河图地图内稍候，或点一次「打开集市」触发同步';
