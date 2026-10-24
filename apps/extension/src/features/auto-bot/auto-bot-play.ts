/**
 * 自动托管对局出牌逻辑：解析操作提示、选牌/选目标/点按钮，必要时请求官方托管。
 * 由 auto-bot-controller 轮询调用 runAutoBotDeal。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { isEnabledFlag, skillItemId } from '../auto-hg/auto-hg-actions.ts';
import {
  SKIP_SELECT_SKILL_ID,
  advanceFallback,
  buttonOrderForCard,
  collectNumberList,
  helpFingerprint,
  officialAiAllowed,
  refreshDecisionState,
  type AutoBotDecisionState,
  type AutoBotHelpRequest,
  type AutoBotMode
} from './auto-bot-actions.ts';

type UnknownRecord = Record<string, unknown>;

export interface AutoBotPlayContext {
  decision: AutoBotDecisionState | null;
  mode: AutoBotMode;
  /** 仅用于自动功能日志，说明本轮没有操作或采取操作的原因。 */
  reason?: string;
}

export interface AutoBotDealOptions {
  /** 只选择运行时明确标记为敌方的座位。 */
  enemyOnly?: boolean;
  /** 将可用锦囊牌排在杀之前。 */
  prioritizeTricks?: boolean;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function sameId(left: unknown, right: unknown): boolean {
  return String(left) === String(right);
}

function cardIdOf(ui: unknown): number {
  const record = asRecord(ui);
  const card = asRecord(record?.Card) ?? asRecord(record?.theCard) ?? record;
  return Number(card?.CardId ?? card?.cardId ?? card?.ID ?? card?.id ?? 0) || 0;
}

function seatIdOf(ui: unknown): number {
  const record = asRecord(ui);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat) ?? record;
  return Number(seat?.SeatID ?? seat?.seatID ?? seat?.index ?? record?.seatID ?? 0);
}

function cardNameOf(ui: unknown): string {
  const record = asRecord(ui);
  const card = asRecord(record?.Card) ?? record;
  return String(card?.CardName ?? card?.cardName ?? card?.name ?? '').replace(/[♠♥♣♦0-9AJQK]+$/g, '');
}

function isTrickCard(ui: unknown): boolean {
  const record = asRecord(ui);
  const card = asRecord(record?.Card) ?? asRecord(record?.theCard) ?? record;
  const trick = card?.IsJinNang ?? card?.isJinNang ?? record?.IsJinNang ?? record?.isJinNang;
  if (trick === true || trick === 1) return true;
  return Number(card?.CardType ?? card?.cardType ?? record?.CardType ?? record?.cardType) === 2;
}

function isShaCard(ui: unknown): boolean {
  return /^(?:杀|火杀|雷杀|冰杀|普通杀)$/.test(cardNameOf(ui));
}

function figureOf(ui: unknown): number {
  const record = asRecord(ui);
  const manager = asRecord(record?.figureManager) ?? asRecord(record?.FigureManager);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat);
  return Number(manager?.Figure ?? manager?.figure ?? seat?.Figure ?? seat?.figure ?? 0);
}

function isDying(ui: unknown): boolean {
  const record = asRecord(ui);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat);
  return !!seat && !seat.isDead && !seat.IsDead && Number(seat.currentHp ?? seat.Hp) <= 0;
}

function teamOf(ui: unknown): string | null {
  const record = asRecord(ui);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat) ?? record;
  for (const value of [seat?.TeamID, seat?.teamId, seat?.teamID, seat?.Camp, seat?.camp]) {
    if (value !== undefined && value !== null && value !== '') return String(value);
  }
  return null;
}

/** shortcut: 仅识别已观察到的敌我字段；拿到山河图实战对象后再补充字段。 */
function isConfirmedEnemySeat(self: UnknownRecord, ui: unknown): boolean {
  const record = asRecord(ui);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat) ?? record;
  if (record?.IsEnemy === true || record?.isEnemy === true || seat?.IsEnemy === true || seat?.isEnemy === true) return true;
  if (record?.IsEnemy === false || record?.isEnemy === false || seat?.IsEnemy === false || seat?.isEnemy === false) return false;
  const ownTeam = teamOf(self);
  const targetTeam = teamOf(ui);
  return ownTeam !== null && targetTeam !== null && ownTeam !== targetTeam;
}

function isAliveSeat(ui: unknown): boolean {
  const record = asRecord(ui);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat) ?? record;
  return !!seat && !seat.isDead && !seat.IsDead;
}

function isRebel(self: UnknownRecord): boolean {
  return figureOf(self) === 3;
}

function isRebelForbiddenCard(ui: unknown): boolean {
  return /^(南蛮|南蛮入侵|万箭|万箭齐发)$/.test(cardNameOf(ui));
}

function isSelected(ui: unknown): boolean {
  const record = asRecord(ui);
  return !!(record?.selected || asRecord(record?.Card)?.Selected || asRecord(record?.seat)?.Selected);
}

function isActivated(ui: unknown): boolean {
  const record = asRecord(ui);
  const card = asRecord(record?.Card);
  const value = record?.activated ?? record?.Activated ?? card?.activated ?? card?.Activated;
  return value === true || value === 1;
}

function mouseClick(record: UnknownRecord, type: string): boolean {
  try {
    if (typeof record.onMouse === 'function') {
      record.onMouse({ type });
      return true;
    }
    if (typeof record.event === 'function') {
      record.event(type, type === 'click' ? record.name : record);
      return true;
    }
  } catch {
    return false;
  }
  return false;
}

function clickCard(ui: unknown): boolean {
  const record = asRecord(ui);
  if (!record) return false;
  try {
    if (typeof record.setSelected === 'function') {
      record.setSelected(true);
      return true;
    }
    if (typeof record.CardUI_Click === 'function') {
      record.CardUI_Click(null);
      return true;
    }
  } catch {
    return false;
  }
  return mouseClick(record, 'click');
}

function clickSeat(ui: unknown): boolean {
  const record = asRecord(ui);
  if (!record) return false;
  if (typeof record.seatClickHandler === 'function') {
    try { record.seatClickHandler(); return true; } catch { return false; }
  }
  return mouseClick(record, 'SELECTE');
}

function clickButton(ui: unknown): boolean {
  const record = asRecord(ui);
  if (!record) return false;
  if (typeof record.onClick === 'function') {
    try { record.onClick(); return true; } catch { return false; }
  }
  return mouseClick(record, 'click');
}

function clickButtonByName(buttons: unknown[], name: string, globalObject?: LayaRuntimeWindow): boolean {
  const found = buttons.map(asRecord).find((item) => item && (item.name === name || String(item.name) === name));
  if (!found || !isEnabledFlag(found, '_enabled')) return false;
  return clickButton(found);
}

function clickButtonByIndex(buttons: unknown[], order: number[], globalObject?: LayaRuntimeWindow): boolean {
  for (const index of order) {
    const button = asRecord(buttons[index]);
    if (button && isEnabledFlag(button, '_enabled')) return clickButton(button);
  }
  return false;
}

function readHelp(self: UnknownRecord, seatUis: unknown[], buttons: unknown[], skills: unknown[], select: UnknownRecord | null): AutoBotHelpRequest {
  const data = asRecord(self.CurStepHelpData) ?? asRecord(self.curStepHelpData);
  const protocol = asRecord(data?.protocol);
  const cardIds = collectNumberList(data?.cardIds, data?.CardIDs, protocol?.CardIDs, protocol?.CardID);
  const seatIds = collectNumberList(data?.completeSeatIds, data?.seatIds, protocol?.DestSeatIDs, protocol?.SeatIDs);
  const protocolName = String(protocol?._className_ ?? protocol?.className ?? '');
  const skillId = /UseCard/i.test(protocolName)
    ? undefined
    : Number(data?.skillId ?? data?.SkillId ?? 0) || undefined;
  const buttonName = String(data?.buttonName || '') || undefined;
  const optionRaw = data?.optionIndex ?? data?.OptionIndex;
  const optionIndex = optionRaw === undefined || optionRaw === null || optionRaw === ''
    ? undefined
    : Number(optionRaw);
  const cardUis = Array.isArray(data?.cardUis) ? data!.cardUis as unknown[] : [];
  const target = data?.target;
  const selectVisible = select?.visible === true;
  const actionable = !!(
    skillId
    || cardIds.length
    || cardUis.length
    || seatIds.length
    || buttonName
    || target
    || (selectVisible && optionIndex !== undefined)
  );
  return { skillId, cardIds, seatIds, buttonName, optionIndex, actionable };
}

/**
 * 执行官方小杀给出的一步。目标可能是选项、按钮、牌或座位。
 * 目标还在但当前不能点时返回 invalid，调用方会等待，不会改走本地出牌。
 */
function executeOfficial(help: AutoBotHelpRequest, self: UnknownRecord, seatUis: unknown[], buttons: unknown[], skills: unknown[], select: UnknownRecord | null, globalObject?: LayaRuntimeWindow): 'acted' | 'waiting' | 'invalid' | 'absent' {
  if (!help.actionable) return 'absent';
  const data = asRecord(self.CurStepHelpData) ?? asRecord(self.curStepHelpData);
  const target = data?.target;
  if (target && typeof target === 'object') {
    const asButton = asRecord(target);
    if (select?.visible && Array.isArray(select.btnList) && (select.btnList as unknown[]).includes(target)) {
      if (!isEnabledFlag(asButton, '_enabled') || typeof select.btnClick !== 'function') return 'invalid';
      (select.btnClick as (item: unknown) => void)(target);
      return 'acted';
    }
    if (buttons.includes(target)) {
      if (!isEnabledFlag(asButton, '_enabled')) return 'invalid';
      clickButton(asButton);
      return 'acted';
    }
    if (typeof asButton?.CardUI_Click === 'function') {
      asButton.CardUI_Click(null);
      return 'acted';
    }
    if (typeof asButton?.seatClickHandler === 'function') {
      asButton.seatClickHandler();
      return 'acted';
    }
    if (asButton) mouseClick(asButton, 'click');
    return 'acted';
  }
  if (help.skillId) {
    const skill = skills.find((item) => sameId(skillItemId(item), help.skillId));
    if (skill && !isSelected(skill)) {
      if (!isActivated(skill)) return 'waiting';
      mouseClick(asRecord(skill)!, 'click');
      return 'acted';
    }
  }
  if (help.cardIds.length) {
    const container = asRecord(self.cardContainer);
    const pool = [
      ...((container?.activatedCardtems as unknown[]) || []),
      ...((container?.cardUis as unknown[]) || []),
      ...((container?.handCardUis as unknown[]) || [])
    ];
    const missing = help.cardIds.some((id) => !pool.some((item) => sameId(cardIdOf(item), id)));
    if (missing) return 'waiting';
    const unselected = pool.find((item) => help.cardIds.some((id) => sameId(cardIdOf(item), id)) && !isSelected(item));
    if (unselected) {
      if (!isActivated(unselected)) return 'invalid';
      clickCard(unselected);
      if (!help.seatIds.length && !help.buttonName && help.optionIndex === undefined && !select?.visible) {
        clickButtonByName(buttons, 'btnOK', globalObject);
      }
      return 'acted';
    }
  }
  if (help.seatIds.length) {
    const mapped = help.seatIds.map((id) => seatUis.find((item) => sameId(seatIdOf(item), id)));
    if (mapped.some((item) => !item)) return 'invalid';
    const unselected = mapped.find((item) => item && !isSelected(item));
    if (unselected && isActivated(unselected)) {
      clickSeat(unselected);
      return 'acted';
    }
  }
  if (help.buttonName) {
    if (clickButtonByName(buttons, help.buttonName, globalObject)) return 'acted';
    return 'waiting';
  }
  if (select?.visible && help.optionIndex !== undefined) {
    const option = asRecord((select.btnList as unknown[])?.[help.optionIndex]);
    if (!option || !isEnabledFlag(option, '_enabled') || typeof select.btnClick !== 'function') return 'invalid';
    (select.btnClick as (item: unknown) => void)(option);
    return 'acted';
  }
  return 'absent';
}

/** 官方没有给出可执行目标时，按本地规则点一张牌或一个按钮。 */
function executeLocal(
  self: UnknownRecord,
  seatUis: unknown[],
  buttons: unknown[],
  skills: unknown[],
  rebel: boolean,
  enemyOnly: boolean,
  prioritizeTricks: boolean,
  globalObject?: LayaRuntimeWindow
): boolean {
  const container = asRecord(self.cardContainer);
  const context = asRecord(container?.SelectContext) ?? asRecord(container?.selectCardContext);
  // 山河图的自动攻击只处理已经能确认的存活敌人。先于任何按钮、技能或卡牌操作判断，
  // 避免把手动操作留在选牌状态，或在敌我信息尚未同步时误操作。
  const hasConfirmedEnemy = !enemyOnly || seatUis.some((item) =>
    isAliveSeat(item) && isConfirmedEnemySeat(self, item)
  );
  if (!hasConfirmedEnemy) return false;
  const skillId = Number(asRecord(context?.Skill)?.SkillId ?? asRecord(context?.Skill)?.ID ?? 0);
  if (skillId === SKIP_SELECT_SKILL_ID && Number(context?.SelectCountMin) === 0 && Number(context?.SelectCountMax) === 0) {
    return clickButtonByName(buttons, 'btnCancel', globalObject) || clickButtonByName(buttons, 'btnOK', globalObject);
  }
  const selectedCards = [
    ...((container?.activatedCardtems as unknown[]) || []),
    ...((container?.cardUis as unknown[]) || [])
  ].filter((item) => isSelected(item));
  const confirmedEnemy = enemyOnly
    ? seatUis.find((item) => isAliveSeat(item)
      && isConfirmedEnemySeat(self, item)
      && isActivated(item)
      && !isSelected(item))
    : undefined;
  if (selectedCards.length) {
    if (enemyOnly && !confirmedEnemy) return false;
    if (confirmedEnemy && clickSeat(confirmedEnemy)) return true;
    return clickButtonByName(buttons, 'btnOK', globalObject);
  }
  const activatedItems = (container?.activatedCardtems as unknown[]) || [];
  const playableCards = [
    ...activatedItems,
    ...((container?.cardUis as unknown[]) || []),
    ...((container?.handCardUis as unknown[]) || [])
  ].filter((item) => !isSelected(item)
    && (activatedItems.includes(item) || isActivated(item))
    && (!rebel || !isRebelForbiddenCard(item)));
  if (prioritizeTricks) {
    playableCards.sort((left, right) => {
      const priority = (card: unknown): number => isTrickCard(card) ? 0 : isShaCard(card) ? 1 : 2;
      return priority(left) - priority(right);
    });
  }
  const dyingRebel = rebel && seatUis.some((item) => figureOf(item) === 3 && isDying(item));
  const playableCard = (dyingRebel && playableCards.find((item) => cardNameOf(item) === '桃'))
    || playableCards[0];
  if (playableCard) {
    clickCard(playableCard);
    // 山河图的目标通常在选牌后才会 Activated；已确认敌人存在时先选牌，下一轮再确认目标。
    if (enemyOnly && !confirmedEnemy) return true;
    const targetSeat = enemyOnly
      ? confirmedEnemy
      : rebel
      ? seatUis.find((item) => figureOf(item) === (cardNameOf(playableCard) === '桃' ? 3 : 1)
        && isActivated(item) && !isSelected(item)
        && (cardNameOf(playableCard) !== '桃' || isDying(item)))
      : seatUis.find((item) => isActivated(item) && !isSelected(item));
    if (targetSeat) clickSeat(targetSeat);
    const name = cardNameOf(playableCard);
    const dying = seatUis.some((item) => {
      const seat = asRecord(asRecord(item)?.seat);
      return seat && !seat.isDead && Number(seat.currentHp ?? seat.Hp) <= 0;
    });
    clickButtonByIndex(buttons, buttonOrderForCard(name, dying, false), globalObject);
    return true;
  }
  const cancel = buttons.find((item) => {
    const name = String(asRecord(item)?.name || '');
    return /btnCancel|取消|不出/.test(name) && isEnabledFlag(item, '_enabled');
  });
  if (cancel) return clickButton(cancel);
  const playableSkill = skills.find((item) => isActivated(item) && !isSelected(item));
  if (playableSkill) return mouseClick(asRecord(playableSkill)!, 'click');
  return clickButtonByName(buttons, 'btnOK', globalObject) || clickButtonByIndex(buttons, [0, 1, 2, 3], globalObject);
}

function requestOfficialHelp(scene: UnknownRecord): void {
  if (typeof scene.RequestAiHelp === 'function') {
    try { scene.RequestAiHelp(); } catch { /* ignore */ }
  } else if (typeof scene.requestAiHelp === 'function') {
    try { scene.requestAiHelp(); } catch { /* ignore */ }
  }
}

function isSelfTurn(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow, self: UnknownRecord): boolean | null {
  const runtime = globalObject as UnknownRecord;
  const browserWindow = asRecord(asRecord(runtime.Laya)?.Browser)?.window;
  const context = locator.gameContext()
    ?? asRecord(runtime.GameContext)
    ?? asRecord(asRecord(browserWindow)?.GameContext);
  const current = context?.currentID ?? context?.CurrentID ?? context?.currentId ?? context?.CurrentId;
  const seat = asRecord(self.seat) ?? asRecord(self.Seat);
  const mine = seat?.SeatID ?? seat?.seatID ?? seat?.SeatId ?? seat?.seatId
    ?? seat?.index ?? seat?.Index
    ?? self.SeatID ?? self.seatID ?? self.SeatId ?? self.seatId
    ?? context?.mySeatID ?? context?.MySeatID ?? context?.selfSeatID ?? context?.SelfSeatID
    ?? context?.myID ?? context?.MyID;
  // 山河图中 currentID / SeatID 的来源与口径并不总是一致。无法可靠比对时交给
  // “可用牌 + 明确敌方目标”双重条件判断，不能把整条自动战斗链路永久拦掉。
  if (current == null || mine == null) return null;
  return String(current) === String(mine);
}

function canUseOfficial(locator: LayaObjectLocator, globalObject: LayaRuntimeWindow): boolean {
  const context = locator.gameContext() ?? asRecord((globalObject as UnknownRecord).GameContext);
  let modeType = 0;
  let trusteeAiManual: boolean | null = null;
  try {
    const vo = typeof context?.GetModeVO === 'function' ? asRecord(context.GetModeVO()) : null;
    modeType = Number(vo?.ModeType ?? vo?.modeType ?? context?.GetModeType?.() ?? 0) || 0;
    if (vo && 'TrusteeAiManual' in vo) trusteeAiManual = !!vo.TrusteeAiManual;
  } catch {
    // 忽略异常
  }
  let canOpen: boolean | null = null;
  try {
    if (typeof context?.CanOpenAiHelp === 'function') canOpen = !!context.CanOpenAiHelp();
  } catch {
    canOpen = null;
  }
  const label = String(asRecord(asRecord(locateGameScene(globalObject))?.topMenu)?.areaServerLabel?.text || '');
  return officialAiAllowed({
    enabled: true,
    modeType,
    modeLabel: label,
    trusteeAiManual,
    canOpenAiHelp: canOpen
  });
}

/**
 * 一拍内尽量执行一次操作。
 */
/** 执行一轮出牌/操作决策：刷新提示状态，自动选牌点确定或回退。 */
export function runAutoBotDeal(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  previous: AutoBotPlayContext,
  options: AutoBotDealOptions = {}
): AutoBotPlayContext {
  const scene = asRecord(locator.gameScene())
    ?? locateGameScene(globalObject)
    ?? asRecord((globalObject as UnknownRecord).gamescene);
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  if (!scene || !self) return { decision: previous.decision, mode: 'off', reason: '未找到对局场景或己方座位' };
  const selfTurn = isSelfTurn(locator, globalObject, self);
  // enemyOnly 是山河图的“只打对手”模式：不代打响应牌，也不在其他人的回合触碰界面。
  if (options.enemyOnly && selfTurn === false) {
    return { decision: previous.decision, mode: 'off', reason: '当前为其他座位回合' };
  }
  const seat = asRecord(self.seat);
  if (Number(seat?.OnlineState) >= 3 && typeof self.stageMoveHandler === 'function') {
    try { self.stageMoveHandler(); } catch { /* ignore */ }
  }
  const bar = asRecord(self.buttonBar) ?? asRecord(self.ButtonBar);
  const buttons = (bar?.btnList as unknown[]) || (bar?.buttons as unknown[]) || [];
  const skills = (self.skillItems as unknown[]) || [];
  const seatUis = (asRecord(scene.seatContainer)?.seatUIs as unknown[]) || [];
  const select = asRecord(self.selectView) ?? asRecord(self.SelectView);
  const help = readHelp(self, seatUis, buttons, skills, select);
  const now = Date.now();
  const key = helpFingerprint(help, String(asRecord(self.cardContainer)?.SelectContext ?? ''));
  let decision = refreshDecisionState(previous.decision, key, now);
  const rebel = isRebel(self);
  const officialOn = !options.enemyOnly && !rebel && canUseOfficial(locator, globalObject);

  if (officialOn && selfTurn) requestOfficialHelp(scene);
  if (officialOn && help.actionable && decision.fallbackLevel === 0) {
    const result = executeOfficial(help, self, seatUis, buttons, skills, select, globalObject);
    if (result === 'acted' && (help.cardIds.length || help.seatIds.length || help.skillId || help.buttonName)) {
      decision = advanceFallback(decision, now, { officialActed: true, officialAvailable: true });
      return { decision, mode: 'ai', reason: '已执行官方 AI 指令' };
    }
    decision = advanceFallback(decision, now, { officialAvailable: result === 'waiting' });
  } else {
    decision = advanceFallback(decision, now, { officialAvailable: officialOn && help.actionable });
  }

  const acted = executeLocal(
    self,
    seatUis,
    buttons,
    skills,
    rebel,
    options.enemyOnly === true,
    options.prioritizeTricks === true,
    globalObject
  );
  return {
    decision,
    mode: acted || decision.fallbackLevel > 0 ? 'local' : previous.mode,
    reason: acted ? '已执行本地出牌' : '等待可用牌或明确敌方目标'
  };
}
