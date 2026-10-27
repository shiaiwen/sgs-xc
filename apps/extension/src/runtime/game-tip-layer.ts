export { isGeneralSkillTipManualCloseVisible } from './general-skill-tip-state.ts';

/** 游戏内武将技能说明等提示层 zOrder，与打包脚本 ri.tipLayer 一致。 */
export const GAME_TIP_LAYER_Z = 2005;

/** 局内小抄 Laya 节点不得超过此值，避免挡住 GameGeneralToolTip 与关闭按钮。 */
export const EXTENSION_Z_BELOW_GAME_TIP = 2000;

export function clampExtensionZOrder(requested: number): number {
  const value = Number.isFinite(requested) ? requested : 0;
  return Math.min(EXTENSION_Z_BELOW_GAME_TIP, Math.max(0, Math.floor(value)));
}
