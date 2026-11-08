import { asRecord, type UnknownRecord } from './skin-runtime.ts';

export interface OtherLocalSkinGateInput {
  otherSwitchOn: boolean;
  gameScene: UnknownRecord | null;
  /** 座位或带 seat 字段的顶栏 manager；不传表示整局是否启用他人换肤。 */
  target?: UnknownRecord | null;
  isSpectatingManager?(manager: UnknownRecord): boolean;
}

/** 国战优先看对局场景，其次看页面上的标记。 */
export function isGuoZhanGameScene(gameScene: UnknownRecord | null): boolean {
  if (gameScene?.isGuoZhan === true) return true;
  const runtimeVi = asRecord(typeof globalThis !== 'undefined' ? (globalThis as UnknownRecord).Vi : null);
  return runtimeVi?.isGuoZhan === true;
}

/** 对局场景还在，且没有被销毁。 */
export function isLiveGameScene(gameScene: UnknownRecord | null): gameScene is UnknownRecord {
  return Boolean(gameScene && gameScene.destroyed !== true);
}

/** 旁观按钮还显示着，就算旁观中。 */
export function isLookOnButtonVisible(lookOnBtn: UnknownRecord | null): boolean {
  if (!lookOnBtn || lookOnBtn.destroyed) return false;
  try {
    if ('_visible' in lookOnBtn) return lookOnBtn._visible === true;
    return lookOnBtn.visible === true;
  } catch {
    return false;
  }
}

function sceneReady(gameScene: UnknownRecord | null): boolean {
  return isLiveGameScene(gameScene);
}

/** 不是国战，并且对局场景还在。 */
function otherSkinSeatGate(gameScene: UnknownRecord | null): boolean {
  return sceneReady(gameScene) && !isGuoZhanGameScene(gameScene);
}

/** 不是国战，对局还在，并且顶栏不是旁观。 */
function otherSkinManagerGate(
  gameScene: UnknownRecord | null,
  manager: UnknownRecord,
  isSpectatingManager?: (manager: UnknownRecord) => boolean
): boolean {
  if (!otherSkinSeatGate(gameScene)) return false;
  if (isSpectatingManager?.(manager)) return false;
  return true;
}

/**
 * 带座位的顶栏走旁观判断，单独的座位不看旁观。
 * 悬停时临时标成自己的，仍走旁观判断。
 */
function otherSkinTargetGate(input: OtherLocalSkinGateInput): boolean {
  const target = input.target;
  if (!target) return false;
  const nestedSeat = asRecord(target.seat);
  if (nestedSeat) {
    return otherSkinManagerGate(input.gameScene, target, input.isSpectatingManager);
  }
  if (target.IsSelf === true) {
    return otherSkinManagerGate(input.gameScene, target, input.isSpectatingManager);
  }
  return otherSkinSeatGate(input.gameScene);
}

/** 他人本地换肤开关打开后，是否允许改这一项。 */
export function isOtherLocalSkinActive(input: OtherLocalSkinGateInput): boolean {
  if (!input.otherSwitchOn) return false;
  if (!input.target) {
    return otherSkinSeatGate(input.gameScene);
  }
  return otherSkinTargetGate(input);
}
