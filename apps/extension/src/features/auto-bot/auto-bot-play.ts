/**
 * 自动托管对局出牌逻辑：解析操作提示、选牌/选目标/点按钮，必要时请求官方托管。
 * 由 auto-bot-controller 轮询调用 runAutoBotDeal。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { readSeatHandCardCount } from '../seat-display/seat-game-adapter.ts';
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
  /** 开启“自动日志”后输出的局面快照，便于复盘选牌与目标过滤。 */
  diagnostic?: Record<string, unknown>;
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

/**
 * 山河图的 SelfSeatUi 没有稳定的 buttonBar 字段名。客户端自身也是先从
 * SelfSeatUi 的直接成员中寻找带 btns 的对象，再把它映射为 buttonBar。
 */
function buttonBarOf(self: UnknownRecord): UnknownRecord | null {
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

/** 山河图主动清手牌时绝不使用防御/响应牌。 */
function isReservedResponseCard(ui: unknown): boolean {
  return /^(?:闪|无懈可击)$/.test(cardNameOf(ui));
}

/** 闪、无懈只在客户端明确要求响应时才能由本地兜底使用，绝不在出牌阶段裸出。 */
function isForcedResponseContext(context: UnknownRecord | null): boolean {
  const text = String(context?.message ?? context?.Message ?? context?.tip ?? context?.Tip ?? '');
  return /请使用|成为.*目标|响应|无懈|火攻.*展示/.test(text);
}

/** 南蛮须出杀、万箭须出闪；这是被动响应，不需要选攻击目标。 */
function aoeResponseCardAllowed(context: UnknownRecord | null, card: unknown): boolean {
  const text = String(context?.message ?? context?.Message ?? context?.tip ?? context?.Tip ?? '');
  const name = cardNameOf(card);
  return (text.includes('南蛮入侵') && isShaCard(card))
    || (text.includes('万箭齐发') && name === '闪');
}

/** 当前客户端在出牌阶段先下发文字提示，随后才更新 CardUI.Activated。 */
function isPlayPhaseContext(context: UnknownRecord | null): boolean {
  const text = String(context?.message ?? context?.Message ?? context?.tip ?? context?.Tip ?? '');
  return /出牌阶段.*选择.*卡牌|请选择一张卡牌/.test(text);
}

function isEquipmentCard(ui: unknown): boolean {
  const record = asRecord(ui);
  const card = asRecord(record?.Card) ?? asRecord(record?.theCard) ?? record;
  return card?.IsEquip === true || card?.isEquip === true
    || record?.IsEquip === true || record?.isEquip === true
    || Number(card?.CardType ?? card?.cardType ?? record?.CardType ?? record?.cardType) === 3;
}

/**
 * 山河图的 Activated 只表示“当前窗口可选”，并不表示一张锦囊必然可以安全
 * 地自动使用。火攻、借刀、铁索、延时锦囊等还会打开二次选牌/多目标窗口，
 * 一旦误入便会把后续拼点、无懈等交互当成主动出牌。这里只放行单目标且没有
 * 额外选择语义的牌；其余牌保留给官方 AI 或玩家处理。
 */
function isSimpleOffensiveTrick(ui: unknown): boolean {
  return /^(?:过河拆桥|顺手牵羊|决斗)$/.test(cardNameOf(ui));
}

/** 仅包含没有额外选牌语义、可由统一“选牌-选目标-确认”流程处理的牌。 */
function isAutoSpendableCard(ui: unknown): boolean {
  if (isReservedResponseCard(ui)) return false;
  // 桃和酒均是稀缺的生存/爆发资源，不能在没有“杀”的确定收益时裸用。
  // 无中与装备不需要目标，主动阶段可安全地立即结算。
  return isShaCard(ui)
    || isSimpleOffensiveTrick(ui)
    || isEquipmentCard(ui)
    || /^(?:无中生有)$/.test(cardNameOf(ui));
}

/** 先扩充资源/装备，再拆顺决斗，最后才打杀；保留桃、酒、闪和无懈。 */
function autoSpendPriority(ui: unknown): number {
  const name = cardNameOf(ui);
  if (name === '无中生有') return 0;
  if (isEquipmentCard(ui)) return 1;
  if (name === '过河拆桥') return 2;
  if (name === '顺手牵羊') return 3;
  if (name === '决斗') return 4;
  if (isShaCard(ui)) return 5;
  return 99;
}

/** 桃、酒、装备、无中不要求敌方座位；其余可消耗牌先取 Boss/逆时针下家。 */
function needsEnemyTarget(ui: unknown): boolean {
  const name = cardNameOf(ui);
  return name !== '无中生有' && !isEquipmentCard(ui);
}

/** 将选择上下文转成稳定指纹，不能把对象直接 String() 成 “[object Object]”。 */
function selectContextFingerprint(context: UnknownRecord | null): string {
  if (!context) return '';
  const skill = asRecord(context.Skill);
  const selected = Array.isArray(context.SelectedCardIds)
    ? context.SelectedCardIds.map((id) => String(id)).join(',')
    : '';
  return [
    context.SpecifySkillId ?? skill?.SkillId ?? skill?.ID ?? '',
    context.message ?? context.Message ?? '',
    context.SelectCountMin ?? '',
    context.SelectCountMax ?? '',
    selected
  ].join('|');
}

/**
 * 拼点会复用手牌的 Activated 与 SelectCount 字段，外观上和主动出牌完全一致。
 * 必须以窗口层的真实状态为准；否则自动战斗会把拼点素材误当作一张可主动打出的牌。
 */
function isPinDianSelecting(locator: LayaObjectLocator): boolean {
  const window = locator.window('PinDianWindow');
  return !!window && window.destroyed !== true && window.visible === true;
}

/** 仅识别已经进入选择/确认阶段的技能，不据此主动发动未知技能。 */
function skillPromptId(self: UnknownRecord, context: UnknownRecord | null): number {
  const help = asRecord(self.CurStepHelpData) ?? asRecord(self.curStepHelpData);
  return Number(
    context?.SpecifySkillId
    ?? asRecord(context?.Skill)?.SkillId
    ?? asRecord(context?.Skill)?.ID
    ?? help?.skillId
    ?? help?.SkillId
    ?? 0
  ) || 0;
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

/** 可见生命与手牌是 QSanguosha 目标防御估算中最稳定、也最适合网页端复用的两个维度。 */
function combatPressure(ui: unknown): { hp: number; hand: number } {
  const record = asRecord(ui);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat) ?? record;
  const hp = Number(seat?.currentHp ?? seat?.Hp ?? seat?.hp ?? 99);
  return {
    hp: Number.isFinite(hp) ? hp : 99,
    hand: readSeatHandCardCount(seat, record)
  };
}

/** 山河图未提供阵营字段时，行动目标固定为己方逆时针方向的下一名存活座位。 */
function nextCounterclockwiseAliveSeat(self: UnknownRecord, seatUis: unknown[]): unknown | undefined {
  const selfIndex = seatUis.indexOf(self);
  const ownSeatId = seatIdOf(self);
  if (selfIndex >= 0) {
    for (let step = 1; step < seatUis.length; step += 1) {
      const candidate = seatUis[(selfIndex + step) % seatUis.length];
      if (isAliveSeat(candidate)) return candidate;
    }
  }
  return seatUis.find((candidate) => isAliveSeat(candidate) && seatIdOf(candidate) !== ownSeatId);
}

/**
 * 山河图沿用 QSanguosha 的“防御最低优先”思路：网页端拿不到武将技能完整语义，
 * 因而只用可靠的生命、手牌和环形距离评分。仅处理客户端已经明确标为敌方的座位。
 */
function bestConfirmedEnemyTarget(
  self: UnknownRecord,
  seatUis: unknown[],
  activatedOnly = false
): unknown | undefined {
  const selfIndex = seatUis.indexOf(self);
  const total = seatUis.length;
  return seatUis
    .filter((item) => isAliveSeat(item)
      && isConfirmedEnemySeat(self, item)
      && (!activatedOnly || (isActivated(item) && !isSelected(item))))
    .sort((left, right) => {
      const leftState = combatPressure(left);
      const rightState = combatPressure(right);
      // 低血与少手牌意味着更低的闪避/反制能力，优先完成击杀。
      const leftDefense = leftState.hp * 3 + leftState.hand;
      const rightDefense = rightState.hp * 3 + rightState.hand;
      if (leftDefense !== rightDefense) return leftDefense - rightDefense;
      if (selfIndex < 0 || total < 2) return 0;
      const distance = (item: unknown) => {
        const index = seatUis.indexOf(item);
        return Math.min((index - selfIndex + total) % total, (selfIndex - index + total) % total);
      };
      return distance(left) - distance(right);
    })[0];
}

function isRebel(self: UnknownRecord): boolean {
  return figureOf(self) === 3;
}

/** 身份模式的 Figure=1 为主公；自动挂机不得将其作为牌的目标。 */
function isLordSeat(self: UnknownRecord, ui: unknown): boolean {
  return ui !== self && figureOf(ui) === 1;
}

function isRebelForbiddenCard(ui: unknown): boolean {
  return /^(南蛮|南蛮入侵|万箭|万箭齐发)$/.test(cardNameOf(ui));
}

/**
 * 身份局目标：反贼攻击忠臣、内奸、主公，绝不攻击同为反贼的队友。
 * 其他身份继续采用保守兜底，不把主公作为本地自动目标。
 */
function isSafeLocalAttackTarget(self: UnknownRecord, ui: unknown): boolean {
  if (!isAliveSeat(ui) || ui === self) return false;
  const selfFigure = figureOf(self);
  const targetFigure = figureOf(ui);
  if (selfFigure === 3) return targetFigure === 1 || targetFigure === 2 || targetFigure === 4;
  if (isLordSeat(self, ui) || targetFigure === 2 || targetFigure === 4) return false;
  return targetFigure === 3 && selfFigure !== 3;
}

/** 在客户端已激活的合法目标中，按左右两个方向的环形距离选最近者。 */
function closestActivatedAttackTarget(self: UnknownRecord, seatUis: unknown[]): unknown | undefined {
  const selfIndex = seatUis.indexOf(self);
  const total = seatUis.length;
  const candidates = seatUis.filter((item) => isSafeLocalAttackTarget(self, item)
    && isActivated(item) && !isSelected(item));
  if (selfIndex < 0 || total < 2) return candidates[0];
  return candidates.sort((left, right) => {
    // 反贼先清附近忠臣，再处理内奸，最后才集火主公；同一身份按左右最近选人。
    const priority = (item: unknown) => ({ 2: 0, 4: 1, 1: 2 } as Record<number, number>)[figureOf(item)] ?? 9;
    const roleDifference = priority(left) - priority(right);
    if (roleDifference) return roleDifference;
    const leftIndex = seatUis.indexOf(left);
    const rightIndex = seatUis.indexOf(right);
    const leftDistance = Math.min((leftIndex - selfIndex + total) % total, (selfIndex - leftIndex + total) % total);
    const rightDistance = Math.min((rightIndex - selfIndex + total) % total, (selfIndex - rightIndex + total) % total);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    // 同身份、同距离时优先收割：低血、少手牌者更难闪避/反制。
    const leftPressure = combatPressure(left);
    const rightPressure = combatPressure(right);
    if (leftPressure.hp !== rightPressure.hp) return leftPressure.hp - rightPressure.hp;
    return leftPressure.hand - rightPressure.hand;
  })[0];
}

function isSelected(ui: unknown): boolean {
  const record = asRecord(ui);
  return !!(record?.selected || record?.Selected || asRecord(record?.Card)?.Selected || asRecord(record?.seat)?.Selected);
}

function isActivated(ui: unknown): boolean {
  const record = asRecord(ui);
  const card = asRecord(record?.Card);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat);
  const value = record?.activated ?? record?.Activated ?? card?.activated ?? card?.Activated
    ?? seat?.activated ?? seat?.Activated;
  return value === true || value === 1;
}

/** 将自动挂机的关键输入压成可读日志，避免输出庞大的 Laya 对象。 */
function playDiagnostic(
  self: UnknownRecord,
  seatUis: unknown[],
  buttons: unknown[],
  context: UnknownRecord | null,
  selfTurn: boolean | null
): Record<string, unknown> {
  const container = asRecord(self.cardContainer);
  const cards = [
    ...((container?.activatedCardtems as unknown[]) || []),
    ...((container?.cardUis as unknown[]) || []),
    ...((container?.handCardUis as unknown[]) || [])
  ];
  const seen = new Set<unknown>();
  return {
    selfFigure: figureOf(self),
    selfTurn,
    prompt: selectContextFingerprint(context),
    seats: seatUis.map((item) => ({
      seatId: seatIdOf(item), figure: figureOf(item), alive: isAliveSeat(item),
      lord: isLordSeat(self, item), activated: isActivated(item), selected: isSelected(item),
      handCardCount: readSeatHandCardCount(asRecord(asRecord(item)?.seat) ?? asRecord(item), asRecord(item))
    })),
    cards: cards.filter((item) => {
      if (seen.has(item)) return false;
      seen.add(item);
      return true;
    }).map((item) => ({
      id: cardIdOf(item), name: cardNameOf(item), activated: isActivated(item), selected: isSelected(item)
    })),
    buttons: buttons.map((item) => {
      const button = asRecord(item);
      return { name: button?.name, enabled: isEnabledFlag(item, '_enabled'), visible: button?.visible };
    })
  };
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
    // CardUI_Click 是客户端真正的手牌输入入口：它会同步选牌上下文和服务端
    // 协议。setSelected 只改 UI 选中态，不能作为山河图自动出牌的首选入口。
    if (typeof record.CardUI_Click === 'function') {
      record.CardUI_Click(null);
      return true;
    }
    if (typeof record.setSelected === 'function') {
      record.setSelected(true);
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

function clickButtonByName(
  buttons: unknown[],
  name: string,
  globalObject?: LayaRuntimeWindow,
  allowStaleEnabled = false
): boolean {
  const found = buttons.map(asRecord).find((item) => item && (item.name === name || String(item.name) === name));
  if (!found || (!allowStaleEnabled && !isEnabledFlag(found, '_enabled'))) return false;
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
    if (isLordSeat(self, target) && !isRebel(self)) return 'invalid';
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
    if (!isRebel(self) && mapped.some((item) => item && isLordSeat(self, item))) return 'invalid';
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
  const playPhase = isPlayPhaseContext(context);
  const forcedResponse = isForcedResponseContext(context);
  const aoeResponse = /南蛮入侵|万箭齐发/.test(String(context?.message ?? context?.Message ?? context?.tip ?? context?.Tip ?? ''));
  // 山河图的自动攻击只处理已经能确认的存活敌人。先于任何按钮、技能或卡牌操作判断，
  // 避免把手动操作留在选牌状态，或在敌我信息尚未同步时误操作。
  const confirmedEnemy = enemyOnly ? bestConfirmedEnemyTarget(self, seatUis) : undefined;
  const counterclockwiseTarget = enemyOnly && !confirmedEnemy
    ? nextCounterclockwiseAliveSeat(self, seatUis)
    : undefined;
  if (enemyOnly && !confirmedEnemy && !counterclockwiseTarget) return false;
  const skillId = Number(asRecord(context?.Skill)?.SkillId ?? asRecord(context?.Skill)?.ID ?? 0);
  if (skillId === SKIP_SELECT_SKILL_ID && Number(context?.SelectCountMin) === 0 && Number(context?.SelectCountMax) === 0) {
    return clickButtonByName(buttons, 'btnCancel', globalObject) || clickButtonByName(buttons, 'btnOK', globalObject);
  }
  const selectedCards = [
    ...((container?.activatedCardtems as unknown[]) || []),
    ...((container?.cardUis as unknown[]) || []),
    ...((container?.handCardUis as unknown[]) || [])
  ].filter((item) => isSelected(item));
  // 山河图会在被动/已发动技能的后续步骤显示 btnOK。此前“只出杀”的保护
  // 误把这类步骤一并拦下；这里只确认已进入技能上下文且按钮确实可用的步骤，
  // 不点击技能图标、不选锦囊，也绝不点击取消。
  if (enemyOnly && skillPromptId(self, context) > 0 && clickButtonByName(buttons, 'btnOK', globalObject)) {
    return true;
  }
  const selectableEnemy = enemyOnly
    ? bestConfirmedEnemyTarget(self, seatUis, true)
      ?? [counterclockwiseTarget].find((item) => item && isActivated(item) && !isSelected(item))
    : undefined;
  if (selectedCards.length) {
    if (enemyOnly && !selectedCards.every(isAutoSpendableCard)) return false;
    // 与客户端原有自动逻辑保持相同的顺序：先尝试确认选牌；只有确认按钮
    // 尚未可用时才选择目标，并再次确认。不能以过期的 _enabled 状态强点，
    // 那会被按钮自身忽略而留下“已选杀、未出牌”的假状态。
    if (enemyOnly) {
      // QS 的 useCard 流程也是先填目标再提交。先点 btnOK 会让山河图把无目标的
      // 确认吞掉，留下“已选牌、未出牌”的状态。
      if (needsEnemyTarget(selectedCards[0])) {
        if (!selectableEnemy) return false;
        const selectedTarget = clickSeat(selectableEnemy);
        const confirmed = clickButtonByName(buttons, 'btnOK', globalObject);
        return selectedTarget || confirmed;
      }
      return clickButtonByName(buttons, 'btnOK', globalObject);
    }
    const target = needsEnemyTarget(selectedCards[0])
      ? closestActivatedAttackTarget(self, seatUis)
      : undefined;
    if (target && clickSeat(target)) return true;
    return clickButtonByName(buttons, 'btnOK', globalObject);
  }
  const activatedItems = (container?.activatedCardtems as unknown[]) || [];
  const playableCards = [
    ...activatedItems,
    ...((container?.cardUis as unknown[]) || []),
    ...((container?.handCardUis as unknown[]) || [])
  ].filter((item) => !isSelected(item)
    // 出牌阶段首帧的 Activated 常常仍为 false；此时仅放行可安全主动使用的
    // 手牌，绝不在响应/选项窗口绕过客户端的可点状态。
    && (activatedItems.includes(item) || isActivated(item) || playPhase || forcedResponse)
    && (!rebel || !isRebelForbiddenCard(item)));
  // 山河图采用逐张消耗策略：保留桃、酒、闪、无懈及复杂锦囊；只有安全牌
  // 才能进入统一的“选牌-选目标-确认”流程。
  // 在没有非主公的存活目标时，不能先选一张需要目标的牌，否则会把选牌流程卡住。
  const hasNonLordTarget = enemyOnly
    ? !!(confirmedEnemy ?? counterclockwiseTarget)
    : seatUis.some((item) => isAliveSeat(item) && !isLordSeat(self, item));
  const hasSafeLocalAttackTarget = seatUis.some((item) => isSafeLocalAttackTarget(self, item));
  const safePlayableCards = (enemyOnly ? playableCards.filter(isAutoSpendableCard) : playableCards)
    .filter((item) => !aoeResponse || aoeResponseCardAllowed(context, item))
    .filter((item) => !isReservedResponseCard(item) || isForcedResponseContext(context))
    .filter((item) => aoeResponseCardAllowed(context, item)
      || !needsEnemyTarget(item) || (enemyOnly ? hasNonLordTarget : hasSafeLocalAttackTarget))
    // 反贼只要存在已确认的敌方目标，就允许使用单目标攻击牌；目标选择统一走
    // “忠臣 → 内奸 → 主公、同类取左右最近”的安全排序，绝不碰反贼队友。
    .filter((item) => !rebel || !needsEnemyTarget(item) || hasSafeLocalAttackTarget);
  if (prioritizeTricks) {
    safePlayableCards.sort((left, right) => {
      const priority = (card: unknown): number => isTrickCard(card) ? 0 : isShaCard(card) ? 1 : 2;
      return priority(left) - priority(right);
    });
  }
  if (enemyOnly) safePlayableCards.sort((left, right) => autoSpendPriority(left) - autoSpendPriority(right));
  const dyingRebel = rebel && seatUis.some((item) => figureOf(item) === 3 && isDying(item));
  const playableCard = (dyingRebel && safePlayableCards.find((item) => cardNameOf(item) === '桃'))
    || safePlayableCards[0];
  if (playableCard) {
    clickCard(playableCard);
    // 山河图的目标通常在选牌后才会 Activated；已确认敌人存在时先选牌，下一轮再确认目标。
    if (enemyOnly) return true;
    const targetSeat = enemyOnly
      ? selectableEnemy
      : needsEnemyTarget(playableCard)
        ? closestActivatedAttackTarget(self, seatUis)
        : undefined;
    if (targetSeat) clickSeat(targetSeat);
    const name = cardNameOf(playableCard);
    const dying = seatUis.some((item) => {
      const seat = asRecord(asRecord(item)?.seat);
      return seat && !seat.isDead && Number(seat.currentHp ?? seat.Hp) <= 0;
    });
    clickButtonByIndex(buttons, buttonOrderForCard(name, dying, false), globalObject);
    return true;
  }
  // 山河图不应把“没有可安全攻击的牌”回退成点取消、技能或任意按钮；
  // 这些控件可能属于弃牌/托管等完全不同的流程。
  if (enemyOnly) return false;
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

function seatIdentityValues(ui: unknown): string[] {
  const record = asRecord(ui);
  const seat = asRecord(record?.seat) ?? asRecord(record?.Seat) ?? record;
  const values = [
    seat?.SeatID, seat?.seatID, seat?.SeatId, seat?.seatId, seat?.index, seat?.Index,
    seat?.PlayerID, seat?.playerID, seat?.playerId, seat?.UserID, seat?.userID, seat?.userId
  ];
  return values
    .filter((value) => value !== undefined && value !== null && value !== '')
    .map((value) => String(value));
}

function isSelfTurn(
  locator: LayaObjectLocator,
  globalObject: LayaRuntimeWindow,
  self: UnknownRecord,
  seatUis: unknown[]
): boolean | null {
  const selfSeat = asRecord(self.seat) ?? asRecord(self.Seat);
  for (const value of [
    self.IsMyTurn, self.isMyTurn, selfSeat?.IsMyTurn, selfSeat?.isMyTurn,
    self.IsCurrentTurn, self.isCurrentTurn, selfSeat?.IsCurrentTurn, selfSeat?.isCurrentTurn
  ]) {
    if (value === true || value === 1) return true;
    if (value === false || value === 0) return false;
  }
  const runtime = globalObject as UnknownRecord;
  const browserWindow = asRecord(asRecord(runtime.Laya)?.Browser)?.window;
  const context = locator.gameContext()
    ?? asRecord(runtime.GameContext)
    ?? asRecord(asRecord(browserWindow)?.GameContext);
  const current = context?.currentID ?? context?.CurrentID ?? context?.currentId ?? context?.CurrentId;
  // RogueLike's currentID can be a player ID or an internal flow ID.  Only
  // reject an action when it maps to a real, non-self seat; otherwise the
  // playable-card and confirmed-enemy checks are the safe gate.
  if (current == null) return null;
  const currentId = String(current);
  const selfIds = new Set([
    ...seatIdentityValues(self),
    ...[context?.mySeatID, context?.MySeatID, context?.selfSeatID, context?.SelfSeatID, context?.myID, context?.MyID]
      .filter((value) => value !== undefined && value !== null && value !== '')
      .map((value) => String(value))
  ]);
  if (selfIds.has(currentId)) return true;
  if (seatUis.some((item) => item !== self && seatIdentityValues(item).includes(currentId))) return false;
  return null;
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
  const seatUis = (asRecord(scene.seatContainer)?.seatUIs as unknown[]) || [];
  // 不能只根据 SelectContext 判断拼点：在当前客户端中，它同样会显示为
  // “选择 1 张牌”。窗口层是这里唯一已由日志验证的区分信号。
  if (options.enemyOnly && isPinDianSelecting(locator)) {
    return { decision: previous.decision, mode: 'off', reason: '等待拼点选牌完成' };
  }
  const selfTurn = isSelfTurn(locator, globalObject, self, seatUis);
  // 山河图的 currentID 会指向下一目标座位，不能据此把己方已激活的手牌
  // 误判为其他座位回合。山河图仍仅处理已激活的杀和逆时针下一名存活座位。
  const seat = asRecord(self.seat);
  // stageMoveHandler 会接管整局的原生托管流程；山河图只允许本插件逐步出杀，
  // 不能调用它，否则一次异常选牌可能演变成全程托管。
  if (!options.enemyOnly && Number(seat?.OnlineState) >= 3 && typeof self.stageMoveHandler === 'function') {
    try { self.stageMoveHandler(); } catch { /* ignore */ }
  }
  const bar = buttonBarOf(self);
  // 当前 H5 客户端的确认/取消按钮位于 buttonBar.btns；旧版本才使用 btnList / buttons。
  const buttons = (bar?.btns as unknown[]) || (bar?.btnList as unknown[]) || (bar?.buttons as unknown[]) || [];
  const skills = (self.skillItems as unknown[]) || [];
  const select = asRecord(self.selectView) ?? asRecord(self.SelectView);
  const help = readHelp(self, seatUis, buttons, skills, select);
  const now = Date.now();
  const cardContainer = asRecord(self.cardContainer);
  const selectContext = asRecord(cardContainer?.SelectContext) ?? asRecord(cardContainer?.selectCardContext);
  const key = helpFingerprint(help, selectContextFingerprint(selectContext));
  let decision = refreshDecisionState(previous.decision, key, now);
  const rebel = isRebel(self);
  const officialOn = !options.enemyOnly && !rebel && canUseOfficial(locator, globalObject);

  if (officialOn && selfTurn) requestOfficialHelp(scene);
  if (officialOn && help.actionable && decision.fallbackLevel === 0) {
    const result = executeOfficial(help, self, seatUis, buttons, skills, select, globalObject);
    if (result === 'acted' && (help.cardIds.length || help.seatIds.length || help.skillId || help.buttonName)) {
      decision = advanceFallback(decision, now, { officialActed: true, officialAvailable: true });
      return {
        decision,
        mode: 'ai',
        reason: '已执行官方 AI 指令',
        diagnostic: playDiagnostic(self, seatUis, buttons, selectContext, selfTurn)
      };
    }
    decision = advanceFallback(decision, now, { officialAvailable: result === 'waiting' });
  } else if (!options.enemyOnly) {
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
    mode: acted ? 'local' : options.enemyOnly ? 'off' : decision.fallbackLevel > 0 ? 'local' : previous.mode,
    reason: acted ? '已执行本地出牌' : '等待可用牌或明确敌方目标',
    diagnostic: playDiagnostic(self, seatUis, buttons, selectContext, selfTurn)
  };
}
