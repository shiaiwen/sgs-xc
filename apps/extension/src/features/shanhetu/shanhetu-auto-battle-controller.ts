/** 山河图战斗内自动出牌：没有明确敌方标记时不操作。 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { DEAL_INTERVAL_MS } from '../auto-bot/auto-bot-actions.ts';
import { runAutoBotDeal, type AutoBotPlayContext } from '../auto-bot/auto-bot-play.ts';
import { AUTO_LOG_ENABLED_KEY } from '../extra-assist/extra-assist-settings.ts';
import {
  SHANHETU_AUTO_BATTLE_KEY,
  SHANHETU_PRIORITIZE_TRICKS_KEY
} from './shanhetu-settings.ts';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function isBattleScene(locator: LayaObjectLocator): boolean {
  return [locator.gameScene(), locator.scene()].some((value) => {
    const scene = asRecord(value);
    return String(scene?.SceneName ?? scene?.sceneName ?? scene?.name ?? '') === 'RogueLikeGameScene';
  });
}

export function installShanhetuAutoBattleController(
  configStore: XiaochaoConfigStore,
  options: { globalObject?: LayaRuntimeWindow; locator?: LayaObjectLocator } = {}
): () => void {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  let play: AutoBotPlayContext = { decision: null, mode: 'off' };
  let lastTrace = '';
  const trace = (event: string, detail: Record<string, unknown> = {}) => {
    if (configStore.get(AUTO_LOG_ENABLED_KEY) !== true) return;
    console.info('[小抄][山河图自动战斗]', event, detail);
  };
  const traceDecision = () => {
    const detail = {
      scene: 'RogueLikeGameScene',
      mode: play.mode,
      reason: play.reason ?? '',
      fallbackLevel: play.decision?.fallbackLevel ?? 0,
      decisionKey: play.decision?.key ?? ''
    };
    const fingerprint = JSON.stringify(detail);
    if (fingerprint === lastTrace) return;
    lastTrace = fingerprint;
    trace('出牌决策', detail);
  };
  const stopConfigWatch = configStore.subscribe(SHANHETU_AUTO_BATTLE_KEY, () => {
    // 开关切换后不沿用上一场/上一轮的回退状态。
    play = { decision: null, mode: 'off' };
    lastTrace = '';
    trace(configStore.get(SHANHETU_AUTO_BATTLE_KEY) === true ? '自动战斗已开启' : '自动战斗已关闭');
  });
  const stopPriorityWatch = configStore.subscribe(SHANHETU_PRIORITIZE_TRICKS_KEY, () => {
    play = { decision: null, mode: 'off' };
    lastTrace = '';
    trace('出牌优先级已更新', {
      prioritizeTricks: configStore.get(SHANHETU_PRIORITIZE_TRICKS_KEY) === true
    });
  });
  const stopLogWatch = configStore.subscribe(AUTO_LOG_ENABLED_KEY, ({ value }) => {
    lastTrace = '';
    if (value === true) trace('日志已开启', {
      autoBattleEnabled: configStore.get(SHANHETU_AUTO_BATTLE_KEY) === true
    });
  });
  const timer = globalObject.setInterval?.(() => {
    if (configStore.get(SHANHETU_AUTO_BATTLE_KEY) !== true || !isBattleScene(locator)) return;
    play = runAutoBotDeal(locator, globalObject, play, {
      enemyOnly: true,
      prioritizeTricks: configStore.get(SHANHETU_PRIORITIZE_TRICKS_KEY) === true
    });
    traceDecision();
  }, DEAL_INTERVAL_MS);
  return () => {
    stopConfigWatch();
    stopPriorityWatch();
    stopLogWatch();
    if (timer != null) globalObject.clearInterval?.(timer);
  };
}
