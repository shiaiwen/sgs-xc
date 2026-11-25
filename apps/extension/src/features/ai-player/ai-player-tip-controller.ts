/**
 * 排位、斗地主、八人匹配：开局或重连后按人机显隐昵称；资料页打开时提示人机并隐藏真人编号按钮。
 */

import { locateGameScene, type GameRuntimeWindow } from '../seat-display/game-scene-locator.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  isUserInfoDialogOpen,
  isUserInfoViewUnderOpenWindow,
  shouldDeferSeatTopManagerSync,
} from '../../runtime/game-native-dialog.ts';
import { showToast } from '../../ui/toast/show-toast.ts';
import { isAiClientId, playNameVisible, readNestedClientId } from './ai-client.ts';
import { isRankOrDoudizhuScene, readSeatClientId, syncSeatPlayName } from './play-name-sync.ts';

type UnknownRecord = Record<string, unknown>;

let profileViewHookInstalled = false;
const profileAiTipState = { clientId: 0 };

/**
 * 安装资料页人机提示，并在协议认为「座位资料应已就绪」时同步昵称。
 * 仅开局/重连往往早于 ClientId、ShowName，需跟发牌列表与回合开始再补一次。
 */
export function installAiPlayerTipController(
  gameEvents: GameEventBus,
  globalObject: GameRuntimeWindow = window
): () => void {
  ensureProfileViewHook(globalObject);
  let aiTipShownThisGame = false;
  let gameEnded = false;

  const stopEvents = gameEvents.subscribe((event) => {
    if (event.type === 'game-ended') {
      gameEnded = true;
      profileAiTipState.clientId = 0;
      return;
    }
    const isLifecycleStart = event.type === 'game-started' || event.type === 'game-reconnected';
    const isSeatDataReady = event.type === 'card-list-ready'
      || (event.type === 'turn-started' && event.round === 0);
    if (!isLifecycleStart && !isSeatDataReady) return;
    if (gameEnded) aiTipShownThisGame = false;
    gameEnded = false;
    syncPlayNamesForScene(globalObject, () => {
      if (aiTipShownThisGame) return;
      aiTipShownThisGame = true;
      showToast('对战AI小杀！', 'warning', 4000);
    });
    if (isLifecycleStart && isUserInfoDialogOpen(globalObject)) refreshOpenProfile(globalObject);
  });

  return () => {
    stopEvents();
  };
}

function maybeTipProfileAi(clientId: number): void {
  if (!isAiClientId(clientId) || profileAiTipState.clientId === clientId) return;
  profileAiTipState.clientId = clientId;
  showToast('小抄: 这是个人机', 'warning', 5000);
}

function refreshOpenProfile(root: GameRuntimeWindow): void {
  const scene = asRecord(locateGameScene(root));
  if (!scene || !isRankOrDoudizhuScene(root, scene)) return;
  const view = findUserInfoView(root);
  if (!view) return;
  const rawClientId = readNestedClientId(view);
  if (rawClientId == null || rawClientId === '') return;
  const clientId = Number(rawClientId);
  if (!Number.isFinite(clientId)) return;
  const button = asRecord(view.result7Btn);
  if (button) button.visible = !isAiClientId(clientId);
  if (isAiClientId(clientId)) maybeTipProfileAi(clientId);
}

function syncPlayNamesForScene(
  globalObject: GameRuntimeWindow,
  onAiOpponents: () => void
): void {
  if (shouldDeferSeatTopManagerSync(globalObject)) return;
  const scene = asRecord(locateGameScene(globalObject));
  if (!scene || !isRankOrDoudizhuScene(globalObject, scene)) return;

  const seatUis = readSeatUis(scene);
  let hasAi = false;
  for (const seatUi of seatUis) {
    try {
      syncSeatPlayName(seatUi, globalObject);
    } catch {
      // 单座资料未就绪时跳过，不影响其他座。
    }
    const seat = asRecord(seatUi.seat);
    if (seat && seat.isHide !== true && playNameVisible(readSeatClientId(seat)) === false) {
      hasAi = true;
    }
  }
  if (hasAi) onAiOpponents();
}

function ensureProfileViewHook(globalObject: GameRuntimeWindow): void {
  if (profileViewHookInstalled) return;
  profileViewHookInstalled = true;
  hookUserInfoView(globalObject, maybeTipProfileAi);
}

/** 资料刷新结束后立刻判断，不等开局扫描。 */
function hookUserInfoView(
  globalObject: GameRuntimeWindow,
  tip: (clientId: number) => void
): void {
  const classUtils = asRecord(asRecord(globalObject.Laya)?.ClassUtils);
  const getClass = classUtils?.getClass;
  if (typeof getClass !== 'function') return;
  let ctor: { prototype?: UnknownRecord } | null = null;
  try {
    ctor = getClass.call(classUtils, 'UserInfoView') as { prototype?: UnknownRecord } | null;
  } catch {
    return;
  }
  const proto = ctor?.prototype;
  const original = proto?.onWinInfo;
  if (!proto || typeof original !== 'function' || original.__xcAiProfileWrapped === true) return;
  const wrapped = function (this: UnknownRecord, ...args: unknown[]) {
    const result = original.apply(this, args);
    const scene = asRecord(locateGameScene(globalObject));
    if (!scene || !isRankOrDoudizhuScene(globalObject, scene)) return result;
    const rawClientId = readNestedClientId(this);
    const clientId = Number(rawClientId);
    if (rawClientId != null && rawClientId !== '' && Number.isFinite(clientId)) {
      const button = asRecord(this.result7Btn);
      if (button) button.visible = !isAiClientId(clientId);
      if (isAiClientId(clientId)) tip(clientId);
    }
    return result;
  };
  wrapped.__xcAiProfileWrapped = true;
  try {
    Object.defineProperty(proto, 'onWinInfo', { configurable: true, writable: true, value: wrapped });
  } catch {
    // 原型不可写时无法挂钩，资料页提示不可用。
  }
}

function findUserInfoView(globalObject: GameRuntimeWindow): UnknownRecord | null {
  const stage = asRecord(asRecord(globalObject.Laya)?.stage);
  if (!stage) return null;
  const layers = childNodes(stage).filter((child) => [4, 5, 6].includes(Number(child.layerOrder)));
  let scanned = 0;
  for (const layer of layers) {
    const found = findView(layer, 0, () => scanned++ < 4000);
    if (found) return found;
  }
  return null;
}

function findView(node: UnknownRecord, depth: number, allow: () => boolean): UnknownRecord | null {
  if (depth > 16 || node.destroyed === true || node.visible === false || !allow()) return null;
  const ctor = typeof node.constructor === 'function' ? node.constructor.name : '';
  const looksLikeUserInfoView = 'userData' in node
    && 'result7Btn' in node
    && typeof node.onWinInfo === 'function';
  if (ctor === 'UserInfoView' || node.name === 'UserInfoView' || looksLikeUserInfoView) {
    if (isUserInfoViewUnderOpenWindow(node)) return node;
  }
  for (const child of childNodes(node)) {
    const found = findView(child, depth + 1, allow);
    if (found) return found;
  }
  return null;
}

function readSeatUis(scene: UnknownRecord): UnknownRecord[] {
  const container = asRecord(scene.seatContainer);
  const list = container?.seatUIs ?? container?.seatUis;
  if (!Array.isArray(list)) return [];
  return list.map(asRecord).filter((seat): seat is UnknownRecord => seat !== null);
}

function childNodes(node: UnknownRecord): UnknownRecord[] {
  const lists = [node._children, node.children];
  const result: UnknownRecord[] = [];
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const child of list) {
      const record = asRecord(child);
      if (record) result.push(record);
    }
  }
  return result;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}