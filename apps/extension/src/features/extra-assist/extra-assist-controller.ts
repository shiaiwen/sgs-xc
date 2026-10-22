/**
 * 进阶辅助总控：开关开启时挂载南华、许劭、裴秀等子辅助，并轮询座位武将 tip。
 * 配置来自 cha_spellextend.sgs（经 CardConfigSource）；关闭时清理裴秀路线状态。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import {
  EXTRA_ASSIST_ENABLED_KEY,
  PEIXIU_ASSIST_KEY,
  SUNQUAN_ASSIST_KEY,
  XUSHAO_ASSIST_KEY
} from './extra-assist-settings.ts';
import {
  buildExtraAssistConfigData,
  type ExtraAssistConfigData
} from './extra-assist-config-data.ts';
import { formatQuanyuTipText, QUANYU_SKILL_ID } from './quanyu-assist.ts';
import { installXuShaoAssist } from './xushao-assist.ts';
import { installPeixiuAssist } from './peixiu-assist.ts';
import type { PeixiuRouteStore } from './peixiu-route-store.ts';
import {
  applySeatGeneralTip,
  clearSeatGeneralTips,
  collectSeatTipTargets
} from './seat-general-tips.ts';
import {
  createZuifengUses,
  formatZuifengTip,
  zuifengSkillIds
} from './zuifeng-assist.ts';

type UnknownRecord = Record<string, unknown>;

export interface ExtraAssistController {
  dispose(): void;
}

export interface ExtraAssistControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  getSpellExtendRaw?: () => unknown;
  getExtraAssistData?: () => ExtraAssistConfigData | null;
  getCard?: (cardId: number) => Record<string, unknown> | null;
  pollIntervalMs?: number;
  peixiuRouteStore?: PeixiuRouteStore;
  gameEvents?: GameEventBus;
}

/**
 * 安装进阶辅助：按配置开关挂载子模块，轮询刷新座位提示。
 * @returns dispose 清理补丁、定时器与 tip
 */
export function installExtraAssistController(
  configStore: XiaochaoConfigStore,
  options: ExtraAssistControllerOptions = {}
): ExtraAssistController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const patcher = createMethodPatcher();
  const pollIntervalMs = options.pollIntervalMs ?? 800;
  let disposed = false;
  let enabled = configStore.get(EXTRA_ASSIST_ENABLED_KEY) === true;
  const characterOn = (key: typeof SUNQUAN_ASSIST_KEY | typeof PEIXIU_ASSIST_KEY | typeof XUSHAO_ASSIST_KEY) => (
    enabled && configStore.get(key) === true
  );
  let cachedConfig: ExtraAssistConfigData | null = null;
  let seatHooksInstalled = false;
  const cleanups: Array<() => void> = [];

  cleanups.push(configStore.subscribe(EXTRA_ASSIST_ENABLED_KEY, ({ value }) => {
    enabled = value === true;
    if (!characterOn(PEIXIU_ASSIST_KEY)) options.peixiuRouteStore?.clear();
    refreshQuanyu();
  }));
  for (const key of [SUNQUAN_ASSIST_KEY, PEIXIU_ASSIST_KEY, XUSHAO_ASSIST_KEY]) {
    cleanups.push(configStore.subscribe(key, () => {
      if (!characterOn(PEIXIU_ASSIST_KEY)) options.peixiuRouteStore?.clear();
      refreshQuanyu();
    }));
  }

  cleanups.push(installXuShaoAssist({
    isEnabled: () => characterOn(XUSHAO_ASSIST_KEY),
    getEntries: () => readConfig()?.shiLun ?? [],
    resolveSpellName: (_spellId, fallback) => fallback,
    locator,
    patcher,
    globalObject
  }));
  cleanups.push(installPeixiuAssist({
    isEnabled: () => characterOn(PEIXIU_ASSIST_KEY),
    locator,
    patcher,
    globalObject,
    cardLookup: { getCard: options.getCard },
    getReward: (rewardId) => readConfig()?.peiXiuRewards[rewardId] ?? null,
    findRewardByName: (name) => {
      const rewards = Object.values(readConfig()?.peiXiuRewards ?? {});
      return rewards.find((item) => item.name === name)?.rewardId ?? 0;
    },
    routeStore: options.peixiuRouteStore,
    getTurnKey: () => peixiuTurnKey
  }));

  const zuifengUses = createZuifengUses();
  let activeTurnSeatId: number | null = null;
  let lastTurnCount = 0;
  let appliedTurnCount = 0;
  let peixiuTurnKey = '0';
  const recentZuifengUses = new Map<string, number>();
  if (options.gameEvents) {
    cleanups.push(options.gameEvents.subscribe((event) => {
      if (event.type === 'game-started' || event.type === 'game-ended') {
        zuifengUses.resetAll();
        activeTurnSeatId = null;
        lastTurnCount = 0;
        appliedTurnCount = 0;
        peixiuTurnKey = '0';
        recentZuifengUses.clear();
        refreshZuifeng();
        return;
      }
      if (event.type === 'turn-started') {
        // MsgGameTurnNtf 常不带 SeatID，只能用来更新回合序号，不能把占位的 0
        // 当成当前行动座位。实际座位由带真实 SeatID 的回合通知确定。
        if (event.turnCount > 0) lastTurnCount = event.turnCount;
        if (event.seatIdKnown === false) return;
        // 两种协议可能重复描述同一次切换；同座位、同回合号不重置已用次数。
        const newTurn = activeTurnSeatId !== event.seatId
          || (lastTurnCount > 0 && lastTurnCount !== appliedTurnCount);
        if (newTurn) {
          peixiuTurnKey = `${lastTurnCount}:${event.seatId}`;
          zuifengUses.resetSeat(event.seatId);
          recentZuifengUses.clear();
        }
        activeTurnSeatId = event.seatId;
        if (lastTurnCount > 0) appliedTurnCount = lastTurnCount;
        refreshZuifeng();
        return;
      }
      if (event.type === 'phase-changed') {
        // 有些浏览器对局只稳定发送 GsCGamephaseNtf；阶段消息里的座位号是当前行动者。
        // phase=0 表示新回合开始，后续阶段只更新可见座位，不重置已用次数。
        if (event.phase === 0) {
          const newTurn = activeTurnSeatId !== event.seatId
            || (lastTurnCount > 0 && lastTurnCount !== appliedTurnCount);
          if (newTurn) {
            peixiuTurnKey = `${lastTurnCount}:${event.seatId}`;
            zuifengUses.resetSeat(event.seatId);
            recentZuifengUses.clear();
          }
          if (lastTurnCount > 0) appliedTurnCount = lastTurnCount;
        }
        activeTurnSeatId = event.seatId;
        refreshZuifeng();
        return;
      }
      if (event.type !== 'spell-targeted') return;
      const scene = locateGameScene(globalObject);
      const skillIds = zuifengSkillIds(scene);
      if (!skillIds.includes(event.spellId)) return;
      if (event.seatId !== activeTurnSeatId) return;
      // 一个主动技可能由客户端和服务器各发一条相同的使用通知；同一回合内
      // 1.2 秒内完全相同的目标/卡牌签名只算一次，避免剩余次数一次跳两格。
      const signature = [
        event.seatId,
        event.spellId,
        [...event.targetSeatIds].sort((left, right) => left - right).join(','),
        [...event.cardIds].sort((left, right) => left - right).join(',')
      ].join(':');
      const now = Date.now();
      const previousUseAt = recentZuifengUses.get(signature);
      if (previousUseAt !== undefined && now - previousUseAt < 1200) return;
      recentZuifengUses.set(signature, now);
      for (const [key, usedAt] of recentZuifengUses) {
        if (now - usedAt > 10000) recentZuifengUses.delete(key);
      }
      zuifengUses.noteUse(event.seatId);
      refreshZuifeng();
    }));
  }

  const pollTimer = globalObject.setInterval?.(() => {
    tryInstallSeatHooks();
    refreshQuanyu();
    refreshZuifeng();
  }, pollIntervalMs);
  if (pollTimer != null) cleanups.push(() => globalObject.clearInterval?.(pollTimer));
  tryInstallSeatHooks();
  refreshQuanyu();

  function readConfig(): ExtraAssistConfigData | null {
    if (cachedConfig) return cachedConfig;
    const ready = options.getExtraAssistData?.();
    if (ready) return (cachedConfig = ready);
    const raw = options.getSpellExtendRaw?.();
    if (!raw) return null;
    return (cachedConfig = buildExtraAssistConfigData(raw));
  }

  function refreshQuanyu(): void {
    if (disposed) return;
    const scene = locateGameScene(globalObject);
    const targets = collectSeatTipTargets(scene?.seatContainer?.seatUIs);
    if (!characterOn(SUNQUAN_ASSIST_KEY)) {
      clearSeatGeneralTips(targets, 'quanyu');
      return;
    }
    applySeatGeneralTip({
      key: 'quanyu',
      targets,
      enabled: true,
      getText: (target) => formatQuanyuTipText(target.seat),
      globalObject
    });
  }

  function refreshZuifeng(): void {
    if (disposed) return;
    const scene = locateGameScene(globalObject);
    const targets = collectSeatTipTargets(scene?.seatContainer?.seatUIs);
    const skillIds = zuifengSkillIds(scene);
    applySeatGeneralTip({
      key: 'zuifeng',
      targets,
      enabled: true,
      getText: (target) => {
        const seat = asRecord(target.seat);
        const seatId = readSeatId(seat);
        if (seatId === null || seatId !== activeTurnSeatId) return '';
        return formatZuifengTip(seat, skillIds, seatId === null ? 0 : zuifengUses.used(seatId));
      },
      globalObject
    });
  }

  function tryInstallSeatHooks(): void {
    if (seatHooksInstalled || disposed) return;
    const scene = locateGameScene(globalObject);
    const seatUIs = scene?.seatContainer?.seatUIs;
    const sample = Array.isArray(seatUIs) ? asRecord(seatUIs[0]) : null;
    const seat = asRecord(sample?.seat);
    const avatar = asRecord(sample?.seatAvatar);
    if (!seat || !avatar) return;
    const seatProto = Object.getPrototypeOf(seat);
    const avatarProto = Object.getPrototypeOf(avatar);
    if (!seatProto || !avatarProto) return;
    seatHooksInstalled = true;
    patcher.wrap(seatProto, 'SetSkillBuffInfo', (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      if (Number(args[0]) === QUANYU_SKILL_ID) refreshQuanyu();
      return result;
    });
    patcher.wrap(avatarProto, 'SetGeneralCard', (original) => function (this: unknown, ...args: unknown[]) {
      const result = original.apply(this, args);
      refreshQuanyu();
      refreshZuifeng();
      return result;
    });
  }

  return {
    dispose() {
      disposed = true;
      for (const cleanup of cleanups.splice(0)) {
        try { cleanup(); } catch { /* ignore */ }
      }
      patcher.restoreAll();
      refreshQuanyu();
      refreshZuifeng();
    }
  };
}

function readSeatId(seat: UnknownRecord | null): number | null {
  if (!seat) return null;
  for (const key of ['seatID', 'seatId', 'SeatID', 'SeatId', 'index', 'Index']) {
    const value = Number(seat[key]);
    if (Number.isInteger(value) && value >= 0 && value < 0xff) return value;
  }
  return null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}
