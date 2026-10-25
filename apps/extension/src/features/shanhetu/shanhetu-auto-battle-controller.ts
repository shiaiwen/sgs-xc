/** 山河图战斗内自动出牌：没有明确敌方标记时不操作。 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import { runAutoBotDeal, type AutoBotPlayContext } from '../auto-bot/auto-bot-play.ts';
import { handleSelectCardWindow } from '../auto-bot/auto-bot-windows.ts';
import { AUTO_LOG_ENABLED_KEY } from '../extra-assist/extra-assist-settings.ts';
import { SHANHETU_AUTO_BATTLE_KEY } from './shanhetu-settings.ts';

type UnknownRecord = Record<string, unknown>;

/** 山河图选牌、选目标和确认的可操作窗口很短，逐步轮询但不触及普通托管流程。 */
const SHANHETU_DEAL_INTERVAL_MS = 250;

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

/** 山河图会把按钮栏挂在 SelfSeatUi 的混淆字段；按客户端同一规则寻找带 btns 的成员。 */
function buttonBarOf(self: UnknownRecord | null): UnknownRecord | null {
  if (!self) return null;
  const named = asRecord(self.buttonBar) ?? asRecord(self.ButtonBar);
  if (named) return named;
  for (const value of Object.values(self)) {
    const candidate = asRecord(value);
    if (Array.isArray(candidate?.btns) || Array.isArray(candidate?.btnList) || Array.isArray(candidate?.buttons)) {
      return candidate;
    }
  }
  return null;
}

function isBattleScene(locator: LayaObjectLocator): boolean {
  return [locator.gameScene(), locator.scene()].some((value) => {
    const scene = asRecord(value);
    return String(scene?.SceneName ?? scene?.sceneName ?? scene?.name ?? '') === 'RogueLikeGameScene';
  });
}

function seatSnapshot(locator: LayaObjectLocator): Array<Record<string, unknown>> {
  const scene = asRecord(locator.gameScene()) ?? asRecord(locator.scene());
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  const selfSeat = asRecord(self?.seat) ?? asRecord(self?.Seat);
  const selfTeam = selfSeat?.TeamID ?? selfSeat?.teamId ?? selfSeat?.teamID ?? selfSeat?.Camp ?? selfSeat?.camp;
  const seatUis = (asRecord(scene?.seatContainer)?.seatUIs as unknown[]) || [];
  return seatUis.map((ui) => {
    const record = asRecord(ui);
    const seat = asRecord(record?.seat) ?? asRecord(record?.Seat) ?? record;
    const team = seat?.TeamID ?? seat?.teamId ?? seat?.teamID ?? seat?.Camp ?? seat?.camp;
    const enemy = record?.IsEnemy ?? record?.isEnemy ?? seat?.IsEnemy ?? seat?.isEnemy;
    const relation = enemy === true || enemy === 1
      ? 'enemy (IsEnemy)'
      : enemy === false || enemy === 0
      ? 'ally (IsEnemy)'
      : selfTeam != null && team != null
      ? String(selfTeam) === String(team) ? 'ally (same team)' : 'enemy (different team)'
      : 'unknown';
    return {
      self: record === self,
      seatId: seat?.SeatID ?? seat?.seatID ?? seat?.index,
      playerId: seat?.PlayerID ?? seat?.playerId ?? seat?.UserID ?? seat?.userId,
      team,
      isEnemy: enemy,
      relation,
      alive: !seat?.isDead && !seat?.IsDead,
      activated: record?.activated ?? record?.Activated ?? seat?.activated ?? seat?.Activated,
      selected: record?.selected ?? record?.Selected ?? seat?.selected ?? seat?.Selected
    };
  });
}

/** 确认按钮是否真实可点击必须从 buttonBar.btns 取证，不能仅凭 CurStepHelpData 推断。 */
function buttonSnapshot(locator: LayaObjectLocator): Array<Record<string, unknown>> {
  const scene = asRecord(locator.gameScene()) ?? asRecord(locator.scene());
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  const bar = buttonBarOf(self);
  const source = Array.isArray(bar?.btns) ? 'btns'
    : Array.isArray(bar?.btnList) ? 'btnList'
    : Array.isArray(bar?.buttons) ? 'buttons'
    : 'none';
  const buttons = (bar?.[source] as unknown[]) || [];
  return buttons.map((button, index) => {
    const record = asRecord(button);
    const data = asRecord(record?.data);
    const parent = asRecord(record?.parent ?? record?._parent);
    const label = asRecord(record?.label ?? record?._label ?? record?.textLabel);
    return {
      source,
      index,
      name: record?.name,
      enabled: record?._enabled ?? record?.enabled,
      rawEnabled: record?._enabled,
      publicEnabled: record?.enabled,
      visible: record?.visible,
      mouseEnabled: record?.mouseEnabled,
      gray: record?.gray,
      label: record?.labelText ?? record?.text ?? label?.text ?? label?.label,
      sendData: data?.sendData,
      dataName: data?.name ?? data?.Name,
      parentName: parent?.name,
      parentClass: parent?._className_ ?? parent?.constructor?.name,
      hasOnClick: typeof record?.onClick === 'function',
      hasEvent: typeof record?.event === 'function',
      keys: record ? Object.keys(record).filter((key) => /enabled|visible|label|text|data|click|mouse|gray/i.test(key)).slice(0, 20) : []
    };
  });
}

function promptSnapshot(locator: LayaObjectLocator): Record<string, unknown> {
  const scene = asRecord(locator.gameScene()) ?? asRecord(locator.scene());
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  const container = asRecord(self?.cardContainer);
  const context = asRecord(container?.SelectContext) ?? asRecord(container?.selectCardContext);
  const skill = asRecord(context?.Skill);
  const help = asRecord(self?.CurStepHelpData) ?? asRecord(self?.curStepHelpData);
  return {
    skillId: context?.SpecifySkillId ?? skill?.SkillId ?? skill?.ID ?? help?.skillId ?? help?.SkillId,
    selectMin: context?.SelectCountMin,
    selectMax: context?.SelectCountMax,
    helpButton: help?.buttonName,
    helpCardIds: help?.cardIds ?? help?.CardIDs,
    helpSeatIds: help?.seatIds ?? help?.completeSeatIds
  };
}

function cardSnapshot(locator: LayaObjectLocator): Array<Record<string, unknown>> {
  const scene = asRecord(locator.gameScene()) ?? asRecord(locator.scene());
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  const container = asRecord(self?.cardContainer);
  const activatedItems = (container?.activatedCardtems as unknown[]) || [];
  const cards = [
    ...activatedItems,
    ...((container?.cardUis as unknown[]) || []),
    ...((container?.handCardUis as unknown[]) || [])
  ];
  const seen = new Set<unknown>();
  return cards.filter((card) => {
    if (seen.has(card)) return false;
    seen.add(card);
    return true;
  }).map((ui) => {
    const record = asRecord(ui);
    const card = asRecord(record?.Card) ?? asRecord(record?.theCard) ?? record;
    return {
      cardId: card?.CardId ?? card?.cardId ?? card?.ID ?? card?.id,
      name: card?.CardName ?? card?.cardName ?? card?.name,
      activated: activatedItems.includes(ui)
        || record?.activated === true || record?.Activated === true || card?.activated === true || card?.Activated === true,
      selected: record?.selected === true || card?.Selected === true
    };
  });
}

/** 供 bug.txt 使用的浅层 Laya 结构；完整对象引用另行输出到 Console，避免循环序列化。 */
function layaNodeSnapshot(value: unknown): Record<string, unknown> | null {
  const node = asRecord(value);
  if (!node) return null;
  const children = Number(node.numChildren ?? (Array.isArray(node._childs) ? node._childs.length : 0)) || 0;
  return {
    name: node.name,
    className: node._className_ ?? node.className ?? node.constructor?.name,
    visible: node.visible,
    destroyed: node.destroyed,
    activated: node.Activated ?? node.activated,
    selected: node.Selected ?? node.selected,
    x: node.x,
    y: node.y,
    width: node.width,
    height: node.height,
    children,
    keys: Object.keys(node).slice(0, 40)
  };
}

function layaRuntimeSnapshot(locator: LayaObjectLocator): Record<string, unknown> {
  const scene = asRecord(locator.gameScene()) ?? asRecord(locator.scene());
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  const container = asRecord(self?.cardContainer);
  const names = ['SelectCardWindow', 'WuGuFengDengWindow', 'PromptLayer', 'PinDianWindow'];
  return {
    scene: layaNodeSnapshot(scene),
    self: layaNodeSnapshot(self),
    buttonBar: layaNodeSnapshot(buttonBarOf(self)),
    cardContainer: layaNodeSnapshot(container),
    cardLists: {
      hand: Array.isArray(container?.handCardUis) ? container.handCardUis.length : 0,
      normal: Array.isArray(container?.cardUis) ? container.cardUis.length : 0,
      activated: Array.isArray(container?.activatedCardtems) ? container.activatedCardtems.length : 0,
      selected: Array.isArray(container?.selectCardUis) ? container.selectCardUis.length : 0
    },
    windows: Object.fromEntries(names.map((name) => [
      name,
      layaNodeSnapshot(name === 'PromptLayer' ? locator.layer(name) : locator.window(name) ?? locator.findWindows(name)[0])
    ]))
  };
}

function layaRuntimeRefs(locator: LayaObjectLocator): Record<string, unknown> {
  const scene = asRecord(locator.gameScene()) ?? asRecord(locator.scene());
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  return {
    scene,
    self,
    buttonBar: buttonBarOf(self),
    cardContainer: self?.cardContainer,
    selectCardWindow: locator.window('SelectCardWindow') ?? locator.findWindows('SelectCardWindow')[0],
    promptLayer: locator.layer('PromptLayer')
  };
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
    // DevTools 导出的日志会把对象折叠为“…”；同时输出 JSON，方便直接从 bug.txt
    // 读取敌我与可出牌判读，不依赖手工展开控制台对象。
    try {
      console.info('[小抄][山河图自动战斗]', `${event}详情`, JSON.stringify(detail));
    } catch {
      // 诊断日志不能影响自动出牌。
    }
  };
  const traceDecision = () => {
    const detail = {
      scene: 'RogueLikeGameScene',
      mode: play.mode,
      reason: play.reason ?? '',
      fallbackLevel: play.decision?.fallbackLevel ?? 0,
      decisionKey: play.decision?.key ?? '',
      seats: seatSnapshot(locator),
      cards: cardSnapshot(locator),
      buttons: buttonSnapshot(locator),
      prompt: promptSnapshot(locator),
      laya: layaRuntimeSnapshot(locator)
    };
    const fingerprint = JSON.stringify(detail);
    if (fingerprint === lastTrace) return;
    lastTrace = fingerprint;
    trace('出牌决策', detail);
    // Console 保留真实对象引用，可直接展开查字段、回调与子节点；不写入 JSON。
    console.info('[小抄][山河图自动战斗] Laya对象引用（可展开）', layaRuntimeRefs(locator));
  };
  const stopConfigWatch = configStore.subscribe(SHANHETU_AUTO_BATTLE_KEY, () => {
    // 开关切换后不沿用上一场/上一轮的回退状态。
    play = { decision: null, mode: 'off' };
    lastTrace = '';
    trace(configStore.get(SHANHETU_AUTO_BATTLE_KEY) === true ? '自动战斗已开启' : '自动战斗已关闭');
  });
  const stopLogWatch = configStore.subscribe(AUTO_LOG_ENABLED_KEY, ({ value }) => {
    lastTrace = '';
    if (value === true) trace('日志已开启', {
      autoBattleEnabled: configStore.get(SHANHETU_AUTO_BATTLE_KEY) === true
    });
  });
  const timer = globalObject.setInterval?.(() => {
    if (configStore.get(SHANHETU_AUTO_BATTLE_KEY) !== true || !isBattleScene(locator)) return;
    // 顺手/拆桥目标确认后的“选择对方区域牌”是独立窗口，必须优先处理。
    if (handleSelectCardWindow(locator)) {
      traceDecision();
      return;
    }
    play = runAutoBotDeal(locator, globalObject, play, {
      enemyOnly: true,
      prioritizeTricks: false
    });
    traceDecision();
  }, SHANHETU_DEAL_INTERVAL_MS);
  return () => {
    stopConfigWatch();
    stopLogWatch();
    if (timer != null) globalObject.clearInterval?.(timer);
  };
}
