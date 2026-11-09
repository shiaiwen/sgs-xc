/** 还没找到裴秀地图时的扫描间隔。地图只靠扫描发现，不挂游戏节点的挂载方法。 */
export const PEIXIU_SEARCH_POLL_MS = 500;

/** 地图已经找到后的扫描间隔，只用来确认地图还在。 */
export const PEIXIU_ACTIVE_POLL_MS = 2000;

/** 地图显示期间比对手牌、选中牌、体力的间隔，变了就重算路线。 */
export const PEIXIU_HAND_WATCH_MS = 200;
