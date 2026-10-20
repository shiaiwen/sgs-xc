/**
 * 山河图功能导出：地图透视、商店预览、剧情隐藏与设置项。
 */

export {
  installShanhetuController,
  type ShanhetuController,
  type ShanhetuControllerOptions
} from './shanhetu-controller.ts';
export {
  installShanhetuMapController,
  type ShanhetuMapController,
  type ShanhetuMapOptions
} from './shanhetu-map-controller.ts';
export {
  buildShanhetuMapConfigData,
  isShanhetuMapConfigReady
} from './shanhetu-map-config-data.ts';
export {
  buildEventBodyLines,
  buildEventLines,
  buildPanelDrafts,
  resolveEventTitle,
  shouldSkipCityEvent
} from './shanhetu-map-event-text.ts';
export {
  buildShanhetuShopPreviewItems,
  hasRogueShopSyncFlag,
  installShanhetuShopController,
  readShopData,
  resolveRogueLikeSyncBody,
  ROGUE_SHOP_DATA_REQ_MARK,
  ROGUE_SHOP_WINDOW,
  type ShanhetuShopController,
  type ShanhetuShopPreviewItem,
  type ShanhetuShopPreviewListener
} from './shanhetu-shop-controller.ts';
export {
  SHANHETU_HIDE_STORY_KEY,
  SHANHETU_HIDE_STORY_SETTING,
  SHANHETU_MAP_KEY,
  SHANHETU_MAP_SETTING,
  SHANHETU_OPEN_SHOP_LABEL,
  SHANHETU_OPEN_SHOP_TOOLTIP,
  SHANHETU_SHOP_PREVIEW_LABEL,
  SHANHETU_SHOP_PREVIEW_TOOLTIP,
  SHANHETU_SWITCH_SETTINGS,
  type ShanhetuSwitchKey,
  type ShanhetuSwitchSetting
} from './shanhetu-settings.ts';
