/** 在游戏原生标签旁单独绘制小抄标签。 */
import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import { createLayaObjectLocator, type LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { GameEvent, GameEventBus } from '../../runtime/game-event-bus.ts';
import { createMethodPatcher } from '../../runtime/method-patch.ts';
import { getMingpaiCardTags } from '../mingpai/graph/card-graph.ts';
import { HAND_LABEL_ALIASES } from '../mingpai/rules/hand-label-aliases.ts';
import { readIncomingCardOwner } from '../mingpai/rules/hand-source-label.ts';
import { readSpellName } from '../mingpai/spell-name.ts';
import { XINYOU_TAG } from '../mingpai/xinyou-tag.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { isNativeHudSuspended } from '../../runtime/native-hud-post-game-guard.ts';
import { CARD_MOVE_ONLY_SHOW, createPublicCardOrigins, publicHandRevealLabel } from './public-card-origins.ts';

type RuntimeObject = Record<string, unknown>;
type Movement = Extract<GameEvent, { type: 'cards-moved' }>;
const HAND_ZONE = 5;
const SHUNJI = 3821;
const JIEWU = 3659;
const YUANJI_MARKS = [
  { spellId: 3639, stateId: 36391, label: '镜花' },
  { spellId: 3640, stateId: 36401, label: '水月' }
] as const;
const NATIVE_BUTTONS = ['cardTagBtn', 'cardTagBtn2', 'cardTagBtn3'] as const;
const MATCH_BUTTONS = ['macthCardTagTex', 'macthCardTagTex2'] as const;

export function installCardLabelController(
  configStore: XiaochaoConfigStore,
  globalObject: LayaRuntimeWindow,
  gameEvents: GameEventBus,
  cardConfig: Pick<CardConfigSource, 'getCard'>
): { dispose(): void; recordMovement(event: Movement, ids: readonly number[], selfSeatId: number | null, source: string | null): void } {
  const locator = createLayaObjectLocator(globalObject);
  const patcher = createMethodPatcher();
  const buttons = new Map<RuntimeObject, RuntimeObject>();
  let activeLabels = new Map<RuntimeObject, { cardId: number; labels: string[] }>();
  const sources = new Map<number, string>();
  const publicOrigins = createPublicCardOrigins();
  const shunjiUsed = new Set<number>();
  const jiewuCards = new Set<number>();
  const qiSelectionUis = new Map<RuntimeObject, number>();
  const jiewuWindows = new WeakMap<RuntimeObject, string>();
  let timer: number | null = null;
  let sessionEnded = false;
  let handContainer: RuntimeObject | null = null;
  let selfSeat: RuntimeObject | null = null;

  function recordMovement(event: Movement, ids: readonly number[], selfSeatId: number | null, source: string | null): void {
    if (sessionEnded) return;
    const fromSelf = event.fromZone === HAND_ZONE && event.fromId === selfSeatId;
    const toSelf = event.toZone === HAND_ZONE && event.toId === selfSeatId;
    const publicIds = publicOrigins.observe(event, toSelf && !fromSelf ? event.cardIds : ids);
    if (fromSelf && toSelf) {
      for (const id of publicIds) {
        if (!sources.has(id)) sources.set(id, publicHandRevealLabel(event.spellId));
      }
    }
    if (event.moveType !== CARD_MOVE_ONLY_SHOW) {
      if (fromSelf && !toSelf) {
        for (const id of [...ids, ...event.cardIds]) if (id > 0) sources.delete(id);
      } else if (toSelf && !fromSelf && labelKey(source) !== XINYOU_TAG) {
        const owner = readIncomingCardOwner({ ...event, selfSeatId });
        // 读取自己的手牌号来对上标签。原持有者以这次移牌的座位为准。
        const receivedIds = owner !== null && source && event.cardIds.length === event.cardCount ? event.cardIds : publicIds;
        for (const id of receivedIds) if (id > 0) sources.set(id, source ?? publicHandRevealLabel(event.spellId));
      }
    }
    if (event.spellId === JIEWU && event.moveType === CARD_MOVE_ONLY_SHOW) {
      const id = ids.find((id) => id > 0);
      if (id) jiewuCards.add(id);
    }
    scheduleRefresh();
  }

  function scheduleRefresh(): void {
    if (timer !== null) return;
    timer = globalObject.setTimeout(() => {
      timer = null;
      refresh();
    }, 0);
  }

  function renderLabel(ui: RuntimeObject): void {
    if (ui.destroyed) return;
    const entry = activeLabels.get(ui);
    const labels = entry?.cardId === cardIdOf(ui) ? entry?.labels ?? [] : [];
    const card = cardOf(ui);
    const modelTags = card?.TagArr1 ?? card?.tagArr1;
    const native = new Set<string>();
    for (const key of NATIVE_BUTTONS) {
      const button = asRecord(ui[key]);
      if (button?.visible && button.drawed !== false) native.add(labelKey(button.label));
    }
    // 心幽始终由原生绘制，重排期间也不补同一张牌的通用明牌标签。
    const hasNativeXinyou = native.has(XINYOU_TAG)
      || (Array.isArray(modelTags) && modelTags.some((tag) => labelKey(tag) === XINYOU_TAG));
    const unique = new Map<string, string>();
    for (const label of labels) {
      const key = labelKey(label);
      if (key === '明牌' && hasNativeXinyou) continue;
      if (key && !native.has(key) && !unique.has(key)) unique.set(key, label);
    }
    const text = [...unique.values()].join('');
    let button = buttons.get(ui);
    if (button?.destroyed) {
      buttons.delete(ui);
      button = undefined;
    }
    if (!text) {
      if (button) button.visible = false;
      return;
    }
    const flatHost = ui.isFlat ? asRecord(ui.textureContainer) : null;
    if (ui.isFlat && !flatHost) return;
    if (!button) {
      if (typeof ui.addDrawChild !== 'function') return;
      button = asRecord(call(ui, 'getCardTagBtn')) ?? undefined;
      if (!button || NATIVE_BUTTONS.some((key) => ui[key] === button)) return;
      ui.addDrawChild.call(ui, button);
      button.mouseEnabled = false;
      button.mouseChildren = false;
      buttons.set(ui, button);
    } else if (Array.isArray(flatHost?.childs) && !flatHost.childs.includes(button)) {
      // 游戏重画平面牌 UI 时可以重建 DrawChild 列表，保留同一个标签元件并重新挂上。
      call(ui, 'addDrawChild', button);
      button.mouseEnabled = false;
      button.mouseChildren = false;
    }
    if (button.label !== text) {
      button.label = text;
      call(ui, 'resetTagSize', button);
    }
    if (button.visible !== true) button.visible = true;
    let y = (Number(ui.height) || 0) - 5;
    for (const key of MATCH_BUTTONS) {
      const sibling = asRecord(ui[key]);
      if (sibling?.visible) y -= (Number(sibling.height) || 0) - 5;
    }
    for (const key of NATIVE_BUTTONS) {
      const sibling = asRecord(ui[key]);
      if (sibling?.visible && sibling.drawed !== false) y -= Number(sibling.height) || 0;
    }
    y -= Number(button.height) || 0;
    if (button.y !== y) button.y = y;
  }

  function removeLabel(ui: RuntimeObject, button: RuntimeObject): void {
    if (ui.destroyed || button.destroyed) {
      buttons.delete(ui);
      return;
    }
    button.visible = false;
    // DrawChild 不一定是普通的 Laya child。没有对应移除接口时保留隐藏节点直到牌面销毁。
    const drawParent = (ui.isFlat && asRecord(ui.textureContainer)) || ui;
    if (typeof drawParent.removeDrawChild !== 'function') return;
    try {
      drawParent.removeDrawChild.call(drawParent, button);
      buttons.delete(ui);
      call(button, 'destroy', true);
    } catch { /* 卡牌面板可能已卸载。 */ }
  }

  function bindLayout(ui: RuntimeObject): void {
    patcher.wrap(methodOwner(ui, 'layoutTagUI'), 'layoutTagUI', (original) => function (this: RuntimeObject, ...args) {
      const result = original.apply(this, args);
      if (activeLabels.has(this) || buttons.has(this)) renderLabel(this);
      return result;
    });
    for (const method of ['clear', 'Clear']) {
      patcher.wrap(methodOwner(ui, method), method, (original) => function (this: RuntimeObject, ...args) {
        const button = buttons.get(this);
        if (button) removeLabel(this, button);
        activeLabels.delete(this);
        qiSelectionUis.delete(this);
        return original.apply(this, args);
      });
    }
  }

  function readUsedSpells(seat: RuntimeObject): void {
    const data = call(seat, 'GetSkillBuffInfo', SHUNJI);
    if (!Array.isArray(data)) return;
    for (const value of data) {
      const id = Number(value);
      if (Number.isSafeInteger(id) && id > 0) shunjiUsed.add(id);
    }
  }

  function updateHandLabels(next: typeof activeLabels, self: RuntimeObject, enabled: boolean): void {
    const seat = selfSeat = asRecord(self.seat);
    const container = handContainer = asRecord(self.cardContainer);
    if (!seat || !container) return;
    for (const method of ['layoutHandCard', 'skillOrStateDataChange']) {
      patcher.wrap(methodOwner(container, method), method, (original) => function (this: RuntimeObject, ...args) {
        const result = original.apply(this, args);
        if (this === handContainer && configStore.get('display.cardLabelsEnabled')) refresh();
        return result;
      });
    }
    const shunji = Boolean(call(seat, 'HasSkill', SHUNJI));
    if (shunji) readUsedSpells(seat);
    patcher.wrap(methodOwner(seat, 'SetSkillBuffInfo'), 'SetSkillBuffInfo', (original) => function (this: RuntimeObject, ...args) {
      const result = original.apply(this, args);
      const currentSelf = asRecord(locateGameScene(globalObject)?.SelfSeatUi);
      if (Number(args[0]) === SHUNJI && this === currentSelf?.seat) {
        readUsedSpells(this);
        scheduleRefresh();
      }
      return result;
    });
    if (!enabled) return;
    const yuanjiMarks = readYuanjiMarks(seat);
    for (const [method, spellArg] of [['AddSkillOutsideCards', 2], ['RemoveSkillOutsideCards', 2], ['ClearSkillOutsideCards', 0]] as const) {
      patcher.wrap(methodOwner(seat, method), method, (original) => function (this: RuntimeObject, ...args) {
        const result = original.apply(this, args);
        if (this === selfSeat && YUANJI_MARKS.some(({ spellId }) => spellId === args[spellArg])) scheduleRefresh();
        return result;
      });
    }
    patcher.wrap(methodOwner(seat, 'UpdateState'), 'UpdateState', (original) => function (this: RuntimeObject, ...args) {
      const result = original.apply(this, args);
      if (this === selfSeat && YUANJI_MARKS.some(({ stateId }) => stateId === args[0])) scheduleRefresh();
      return result;
    });
    for (const ui of cardUis(container, ['cardUis', 'cardUIs', 'handCardUis', 'handCardUIs'])) {
      const cardId = cardIdOf(ui);
      if (!(cardId > 0)) continue;
      const labels = yuanjiMarks.get(cardId) ?? [];
      if (isQi(cardId)) labels.push('炁');
      if (shunji) {
        const card = cardOf(ui);
        const nativeSpell = Number(card?.FirstSkillId ?? card?.SpellId);
        const spellId = nativeSpell > 0 ? nativeSpell : Number(cardConfig.getCard(cardId)?.spellId);
        if (spellId > 0 && !shunjiUsed.has(spellId)) labels.push('[顺机]');
      }
      const source = sources.get(cardId);
      if (source) labels.push(source);
      if (labels.length) next.set(ui, { cardId, labels });
    }
  }

  function refresh(): void {
    const next: typeof activeLabels = new Map();
    const scene = asRecord(locateGameScene(globalObject));
    const enabled = configStore.get('display.cardLabelsEnabled');
    handContainer = null;
    selfSeat = null;
    if (scene && !sessionEnded && !isNativeHudSuspended()) {
      installDuoQiRemark();
      installJiewuWindowHook();
      const self = asRecord(scene.SelfSeatUi);
      if (self) updateHandLabels(next, self, enabled);
      if (enabled) {
        const seats = new Set([self, ...cardUis(asRecord(scene.seatContainer), ['seatUIs', 'seatUis'])]);
        for (const seat of seats) {
          const equips = [
            ...cardUis(asRecord(seat?.cardContainer), ['equipCardUis', 'equipCardUIs']),
            ...cardUis(seat, ['equipCardUis', 'equipCardUIs'])
          ];
          for (const ui of equips) {
            const cardId = cardIdOf(ui);
            if (isQi(cardId)) next.set(ui, { cardId, labels: ['炁'] });
          }
        }
        if (jiewuCards.size) {
          const win = locator.window('SkillBuQuWindow');
          if (win && !win.destroyed && win.visible !== false && (win.parent || win._parent)) {
            const label = jiewuWindows.get(win) ?? jiewuLabel(win.Skill, asRecord(win.windowTitleTxt)?._innerHTML);
            for (const ui of cardUis(win, ['handCardUis', 'cardUIList'])) {
              const cardId = cardIdOf(ui);
              if (label && jiewuCards.has(cardId)) next.set(ui, { cardId, labels: [label] });
            }
          }
        }
      }
      for (const [ui, cardId] of qiSelectionUis) {
        if (ui.destroyed || ui.visible === false || cardIdOf(ui) !== cardId || !isQi(cardId)) {
          qiSelectionUis.delete(ui);
        } else if (enabled) {
          const entry = next.get(ui) ?? { cardId, labels: [] };
          entry.labels.push('炁');
          next.set(ui, entry);
        }
      }
    }
    activeLabels = next;
    for (const [ui, button] of buttons) {
      if (ui.destroyed || button.destroyed || !next.has(ui)) removeLabel(ui, button);
    }
    for (const ui of next.keys()) {
      bindLayout(ui);
      renderLabel(ui);
    }
  }

  function installDuoQiRemark(): void {
    patcher.wrap(locator.classPrototype('DuoQi'), 'SkillCardRemark', (original) => function (this: RuntimeObject, ...args) {
      const result = original.apply(this, args);
      const ui = asRecord(args[0]);
      // 原生方法也会收到 Card 对象来生成游戏标签，只给选牌 UI 加小抄控件。
      if (ui && typeof ui.addDrawChild === 'function' && isQi(cardIdOf(ui))) {
        qiSelectionUis.set(ui, cardIdOf(ui));
        scheduleRefresh();
      }
      return result;
    });
  }

  function installJiewuWindowHook(): void {
    patcher.wrap(locator.classPrototype('SkillBuQuWindow'), 'enterWindow', (original) => function (this: RuntimeObject, ...args) {
      jiewuWindows.delete(this);
      const result = original.apply(this, args);
      const label = jiewuLabel(args[1], asRecord(this.windowTitleTxt)?._innerHTML);
      if (label) jiewuWindows.set(this, label);
      scheduleRefresh();
      return result;
    });
  }

  const stopEvents = gameEvents.subscribe((event) => {
    switch (event.type) {
      case 'game-started':
      case 'game-ended':
      case 'game-reconnected':
        sessionEnded = event.type === 'game-ended';
        sources.clear();
        publicOrigins.clear();
        shunjiUsed.clear();
        jiewuCards.clear();
        qiSelectionUis.clear();
        refresh();
        break;
      case 'phase-changed':
        if (event.phase === 0) jiewuCards.clear();
        scheduleRefresh();
        break;
      case 'cards-used':
      case 'spell-data-updated':
        scheduleRefresh();
        break;
    }
  });
  const stopConfig = configStore.subscribe('display.cardLabelsEnabled', refresh);
  refresh();

  return {
    recordMovement,
    dispose() {
      stopEvents();
      stopConfig();
      if (timer !== null) globalObject.clearTimeout(timer);
      activeLabels.clear();
      for (const [ui, button] of buttons) removeLabel(ui, button);
      buttons.clear();
      patcher.restoreAll();
    }
  };
}

function readYuanjiMarks(seat: RuntimeObject): Map<number, string[]> {
  const marks = new Map<number, string[]>();
  // 新版原生牌面通过座位状态的 Targets 读牌号。只读已存在的状态，避免 GetSeatState 创建空状态。
  const states = asRecord(seat.SeatStateDic ?? seat.seatStateDic);
  for (const { spellId, stateId, label } of YUANJI_MARKS) {
    const state = states && asRecord(call(states, 'getNumberKey', stateId));
    if (state && (state.Opened === false || state.Value === 0)) continue;
    // 老客户端没有单独的卡牌状态，镜花、水月从技能牌名单显示。
    const cards = state ? state.Targets : call(seat, 'GetSkillOutsideCards', spellId);
    if (!Array.isArray(cards)) continue;
    for (const card of cards) {
      const id = typeof card === 'number' ? card : cardIdOfCard(asRecord(card));
      if (!(id > 0)) continue;
      const labels = marks.get(id) ?? [];
      if (!labels.includes(label)) labels.push(label);
      marks.set(id, labels);
    }
  }
  return marks;
}

function jiewuLabel(skillValue: unknown, title: unknown): string | null {
  const skill = asRecord(skillValue);
  const id = Number(skill?.SkillId ?? skill?.ID);
  const name = [readSpellName(id), skill?.Name].find((name): name is string => typeof name === 'string' && name.includes('捷悟'));
  if (name) return `[${HAND_LABEL_ALIASES[name] ?? name.slice(0, 2)}]`;
  return id === JIEWU || (typeof title === 'string' && title.includes('捷悟')) ? '[捷悟]' : null;
}

function methodOwner(target: RuntimeObject, key: string): RuntimeObject | null {
  let owner: RuntimeObject | null = target;
  while (owner && !Object.hasOwn(owner, key)) owner = Object.getPrototypeOf(owner);
  return owner;
}

function isQi(cardId: number): boolean {
  return cardId > 0 && getMingpaiCardTags(cardId).includes('炁');
}

function cardOf(ui: RuntimeObject): RuntimeObject | null {
  return asRecord(ui.Card) ?? asRecord(ui.theCard) ?? asRecord(ui.card);
}

function cardIdOf(ui: RuntimeObject): number {
  return cardIdOfCard(cardOf(ui));
}

function cardIdOfCard(card: RuntimeObject | null): number {
  return Number(card?.CardId ?? card?.cardId ?? card?.CardID ?? 0);
}

/** 效果名与来源前缀使用同一个去重键。调用方先加入仍生效的标签。 */
function labelKey(value: unknown): string {
  const text = String(value ?? '').replace(/<[^>]*>|[\u200b-\u200f\ufeff]/g, '').trim();
  const source = /^(?:\[([^\]]+)\]|【([^】]+)】)/.exec(text);
  return (source?.[1] ?? source?.[2] ?? text).trim();
}

function cardUis(target: RuntimeObject | null, keys: readonly string[]): RuntimeObject[] {
  for (const key of keys) {
    const list = target?.[key];
    if (Array.isArray(list) && list.length) return list.map(asRecord).filter((ui) => ui !== null);
  }
  return [];
}

function asRecord(value: unknown): RuntimeObject | null {
  return value !== null && typeof value === 'object' ? value as RuntimeObject : null;
}

function call(target: RuntimeObject, name: string, ...args: unknown[]): unknown {
  const method = target[name];
  return typeof method === 'function' ? method.apply(target, args) : undefined;
}
