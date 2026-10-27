import type { LayaRuntimeWindow } from '../adapters/laya-object-locator.ts';

/** 游戏内武将技能说明等提示层 zOrder，与打包脚本 ri.tipLayer 一致。 */
export const GAME_TIP_LAYER_Z = 2005;

/** 局内小抄 Laya 节点不得超过此值，避免挡住 GameGeneralToolTip 与关闭按钮。 */
export const EXTENSION_Z_BELOW_GAME_TIP = 2000;

const TIP_NAME = 'GameGeneralToolTip';
const MANAGER_CLASS = 'XHt';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function readTipsManager(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  try {
    const ctor = globalObject.Laya?.ClassUtils?.getClass?.(MANAGER_CLASS) as { I?: () => unknown } | undefined;
    const inst = asRecord(typeof ctor?.I === 'function' ? ctor.I() : null);
    if (inst && typeof inst.TipsHide === 'function') return inst;
  } catch {
    // ClassUtils 可能未注册。
  }
  return null;
}

function isVisibleGeneralTip(tip: UnknownRecord): boolean {
  if (tip.name !== TIP_NAME || tip.destroyed === true) return false;
  if (tip.visible === false || tip._visible === false) return false;
  const alpha = Number(tip.alpha);
  if (Number.isFinite(alpha) && alpha <= 0.01) return false;
  return true;
}

/** 关闭钮已显示：说明处于停驻态，扩展层不应再抢鼠标。只读，不改 tip 生命周期。 */
export function isGeneralSkillTipStayInteractive(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): boolean {
  const manager = readTipsManager(globalObject);
  if (!manager) return false;
  const visit = (raw: unknown): boolean => {
    const tip = asRecord(raw);
    if (!tip || !isVisibleGeneralTip(tip)) return false;
    const closeBtn = asRecord(tip.closeBtn);
    if (!closeBtn || closeBtn.destroyed === true) return false;
    if (closeBtn.visible === false || closeBtn._visible === false) return false;
    return true;
  };
  if (visit(manager.staticTip2)) return true;
  if (visit(manager.currentTip)) return true;
  if (Array.isArray(manager.viewArr)) {
    for (const item of manager.viewArr) {
      if (visit(item)) return true;
    }
  }
  return false;
}

export function clampExtensionZOrder(requested: number): number {
  const value = Number.isFinite(requested) ? requested : 0;
  return Math.min(EXTENSION_Z_BELOW_GAME_TIP, Math.max(0, Math.floor(value)));
}
