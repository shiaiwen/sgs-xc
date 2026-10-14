/**
 * 明牌控制器：订阅游戏事件，驱动明牌引擎更新手牌/牌堆/临时区等分区，
 * 并把看牌、移牌规则解析后的揭示结果写入统一鉴定汇点。
 */

import type { GameEvent, GameEventBus } from '../../runtime/game-event-bus.ts';
import type { SeatStateStore } from '../seat-display/seat-state-store.ts';
import { isNationWarMode } from '../seat-display/seat-state.ts';
import {
  createMingpaiEngine,
  formatZoneId,
  DISCARD_ZONE,
  DRAW_PILE_ZONE,
  HAND_ZONE,
  TEMPORARY_CARD_ZONES,
  type MingpaiEngine
} from './mingpai-engine.ts';
import { MINGPAI_ZONE } from './mingpai-zones.ts';
import { applyCardReveals } from './reveal-sink.ts';
import {
  correctMoveCard,
  getObfuscated3483PileCount,
  isObfuscatedSameZoneShow,
  judgeOptTarget,
  judgeSpellOpt,
  noteObfuscatedCurrentSeat,
  noteObfuscatedSeatColor,
  noteObfuscatedUseSpell,
  resetObfuscatedJudge,
  takeHiddenZoneCards,
  takeQiDiscardCards
} from './obfuscated-judge.ts';
import { isXinyouCardGain, XINYOU_TAG, xinyouTagExpires } from './xinyou-tag.ts';
import {
  advanceSeatGridTrace,
  advanceUniqueSeatGridTrace,
  clearTempZoneGrids
} from './graph/temporary-zone-grid.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { resolveSkillIds } from '../skill-assist/skill-visibility.ts';
import { traceMingpai } from '../../runtime/mingpai-trace.ts';
import { legacyIncomingHandLabel } from './rules/legacy-hand-label.ts';
import { DRAW_PILE_OWNER } from './rules/reveal-types.ts';

type MoveCardEvent = Extract<GameEvent, { type: 'cards-moved' }>;

export interface MingpaiControllerOptions {
  /** 兼容旧调用：未传入时内部自建引擎。 */
  engine?: MingpaiEngine;
  /** 红色 true、黑色 false、未知 null；按颜色还原的技能（3543 / 3571）需要。 */
  isRedCard?: (cardId: number) => boolean | null;
  /** 原生牌类型；读不到时返回 0。四张类型 8 的特殊摸牌不计入牌堆顺序。 */
  cardType?: (cardId: number) => number;
}

/**
 * 明牌控制器：吸收原 known-hand-card-controller 全部协议路径，
 * 并维护分区投影（unknown / 手牌区 / 技能条）。运行时不依赖 legacy。
 */
export function installMingpaiController(
  seatStateStore: SeatStateStore,
  gameEvents: GameEventBus,
  { engine: injected, isRedCard = () => null, cardType = () => 0 }: MingpaiControllerOptions = {}
): { dispose: () => void; engine: MingpaiEngine } {
  const engine = injected ?? createMingpaiEngine();
  const activeQiSeats = new Set<number>();
  const eligibleQiKillersByVictim = new Map<number, Set<number>>();
  let pendingQiDeath: { victimSeatId: number; killerSeatId: number | null } | null = null;
  let pendingQiTransfer: {
    originalOwnerSeatId: number;
    recipientSeatId: number;
    expiresAfterMovement: number;
  } | null = null;
  let movementSequence = 0;
  let xinyouCaster: { seatId: number; expiresAfterMovement: number } | null = null;
  let qiStateObserved = false;
  let synchronizingPersistentTags = false;
  /** 重连包没有牌序快照，等座位场景公开手牌后再登记一次。 */
  let reconnectNeedsHands = false;
  /** 本局的整副牌，断线重建时用。 */
  let lastCardList: number[] = [];

  const unsubscribeSeatState = seatStateStore.subscribe((snapshot) => {
    if (synchronizingPersistentTags) return;
    synchronizingPersistentTags = true;
    try {
      snapshot.seats.forEach((seat) => {
        // 浏览器端可能先把场景手牌列表清空，再送达或省略移牌卡号。
        // 手牌数明确为 0 时，清除引擎仍挂在该座位手牌区的旧明牌，避免牌条残留。
        if (!seat.isAlive || seat.knownCards.length + seat.unknownCardCount === 0) {
          engine.clearKnownHandCards(seat.seatId);
          return;
        }
        const equipmentIds = new Set(
          (seat.equipmentCards ?? []).map((card) => card.cardId).filter((cardId) => cardId > 0)
        );
        seat.knownCards.forEach((card) => {
          if (equipmentIds.has(card.cardId)) return;
          engine.observeKnownHandCard(card.cardId, seat.seatId, card.tags);
          const persistentTags = engine.getPersistentTags(card.cardId);
          if (persistentTags.length) {
            seatStateStore.setPersistentKnownCardTags(card.cardId, persistentTags);
          }
        });
      });
    } finally {
      synchronizingPersistentTags = false;
    }
    if (reconnectNeedsHands) reconcileHandsFromScene();
  });

  const unsubscribe = gameEvents.subscribe((rawEvent) => {
    if (rawEvent.type === 'cards-moved') {
      handleCardsMoved(rawEvent);
      return;
    }
    const event = rawEvent;
    if (event.type === 'deck-shuffled') {
      // 真洗牌由移牌管线的「2 区 → 9 区」分支处理，它会把牌堆整堆打回未知。
      // 这里按类名匹配的洗牌事件范围太宽（换一张牌到牌堆顶也会命中），
      // 再清一次会把刚记住的顶牌抹掉，所以不再动牌堆顺序。
      return;
    }
    if (event.type === 'game-reconnected') {
      // 断线后一切都要重建：牌堆顺序、判定纠偏、炁的转移状态、牌面标签全部丢掉，
      // 再按本局总牌表把整副牌当作牌堆里的未知牌，最后用场上仍公开的手牌归位。
      dropUntrustedOrder();
      resetObfuscatedJudge();
      resetQiTransferState();
      seatStateStore.resetKnownHands();
      if (lastCardList.length) engine.resetAllCardsToDrawPile(lastCardList);
      reconnectNeedsHands = true;
      reconcileHandsFromScene();
      return;
    }
    if (event.type === 'game-ended') {
      resetObfuscatedJudge();
      // 同房间结算/再开不切场景，只能靠协议清空；不要 store.clear() 把 inGame 打成 false，
      // 否则下一帧场景轮询又会当成新的 game-started，并把残留 CardUi 写回引擎。
      clearTempZoneGrids();
      engine.clear();
      engine.noteGameSettled();
      resetQiTransferState();
      seatStateStore.resetKnownHands();
      return;
    }
    if (event.type === 'game-started') {
      // 开局一律丢掉上一局缓存。热重载恢复只留给 game-reconnected。
      resetObfuscatedJudge();
      clearTempZoneGrids();
      resetQiTransferState();
      lastCardList = [];
      engine.clear();
      seatStateStore.resetKnownHands();
      return;
    }
    if (event.type === 'card-list-ready') {
      // + 开局总牌表：整副牌各占一个未知槽位，之后的移牌把它们逐步归位。
      lastCardList = [...event.cardIds];
      engine.resetAllCardsUnknown(lastCardList);
      traceMingpai('card-list', { count: event.cardIds.length, maxId: Math.max(...event.cardIds) });
      return;
    }
    if (event.type === 'hand-cards-revealed') {
      traceMingpai('reveal', {
        source: 'hand-cards-revealed', zone: 'hand', ownerId: event.seatId, cardIds: [...event.cardIds]
      });
      event.cardIds.forEach((cardId) => {
        engine.observeKnownHandCard(cardId, event.seatId, []);
      });
      seatStateStore.revealKnownHand(event.seatId, event.cardIds);
      return;
    }
    if (event.type === 'temporary-cards-reordered') {
      // 技能临时区的层内顺序靠操作回报三元组推进；座位下只有一个未返完的追踪时直接接管。
      const advanced = advanceSeatGridTrace(event.seatId, event.spellId, event.trace);
      if (!advanced) advanceUniqueSeatGridTrace(event.seatId, event.trace);
      return;
    }
    if (event.type === 'opt-target') {
      const srcSeatId = event.srcSeatId ?? event.seatId;
      const snapshot = seatStateStore.getSnapshot();
      const reveals = judgeOptTarget({
        spellId: event.spellId,
        param: event.param,
        params: event.params,
        cardIds: event.cardIds ?? [],
        srcSeatId,
        targetSeatId: event.targetSeatId,
        optType: event.optType ?? null,
        myId: snapshot.selfSeatId,
        mySeats: snapshot.controlledSeatIds,
        isHandLookSpell
      });
      traceMingpai('opt-target', {
        spellId: event.spellId, param: event.param, params: [...event.params], optType: event.optType ?? null,
        srcSeatId, targetSeatId: event.targetSeatId, matchedReveals: reveals.length
      });
      applyCardReveals(reveals, engine, seatStateStore, `opt-target:${event.spellId}`);
      return;
    }
    if (event.type === 'spell-opt-rep') {
      const reveals = judgeSpellOpt(event.spellId, event.optType, event.seatId, event.datas);
      traceMingpai('spell-opt-rep', {
        spellId: event.spellId, optType: event.optType, seatId: event.seatId,
        datas: [...event.datas], matchedReveals: reveals.length
      });
      applyCardReveals(reveals, engine, seatStateStore, `spell-opt-rep:${event.spellId}`);
      return;
    }
    if (event.type === 'seat-state-changed' && event.stateId === 0xdf3) {
      noteObfuscatedSeatColor(event.seatId, Math.trunc(event.value / 100));
    }
    if (event.type === 'seat-state-changed' && event.stateId === QI_STATE_ID) {
      updateQiSeatState(event.seatId, event.value);
      return;
    }
    if (event.type === 'spell-data-updated' && isJiaoyuSpell(event.dataId)) {
      // 椒遇：技能私有数据第一位就是这个座位的判定颜色（1 红 / 2 黑）。
      const color = Math.trunc(Number(event.datas[0]));
      if (color === 1 || color === 2) noteObfuscatedSeatColor(event.seatId, color);
      return;
    }
    if (event.type === 'player-died') {
      recordQiPlayerDeath(event.seatId, event.killerSeatId);
      return;
    }
    if (event.type === 'cards-used') {
      event.cardIds.filter((cardId) => cardId > 0).forEach(clearXinyouTag);
    }
    if (event.type === 'phase-changed') noteObfuscatedCurrentSeat(event.seatId);
    if (event.type === 'phase-changed' && xinyouTagExpires(event.phase)) {
      clearAllXinyouTags();
    }
    if (event.type === 'spell-targeted' && QI_TRANSFER_SPELL_IDS.has(event.spellId)) {
      recordQiTransferSpell(event.seatId, event.targetSeatIds);
    }
    if (event.type === 'spell-targeted') {
      noteObfuscatedUseSpell(
        event.spellId,
        event.seatId,
        event.cardIds,
        seatStateStore.getSnapshot().selfSeatId,
        event.targetSeatIds,
        event.effectIndex ?? null
      );
      if (isXinyouSpell(event.spellId)) {
        xinyouCaster = { seatId: event.seatId, expiresAfterMovement: movementSequence + 8 };
      }
    }
  });

  /** 这张牌被使用或打出后去掉心幽，不计入手牌上限的效果到此结束。 */
  function clearXinyouTag(cardId: number): void {
    if (!engine.getPersistentTags(cardId).includes(XINYOU_TAG)) return;
    engine.forgetPersistentCardTag(cardId, XINYOU_TAG);
    seatStateStore.setPersistentKnownCardTags(cardId, engine.getPersistentTags(cardId));
  }

  /** 弃牌阶段结束后，本回合所有心幽牌都恢复计入手牌上限。 */
  function clearAllXinyouTags(): void {
    engine.getSnapshot().records.forEach((record) => {
      if (record.persistentTags.includes(XINYOU_TAG)) clearXinyouTag(record.cardId);
    });
  }

  /** 断线或局面不可信时丢掉牌堆顺序和临时区，避免用旧顺序猜牌。 */
  function dropUntrustedOrder(): void {
    clearTempZoneGrids();
    xinyouCaster = null;
    engine.clearKnownDrawPileOrder();
  }

  /** 用场景里看得见的手牌和装备，把明牌引擎里已经不在手里的牌清掉。 */
  function reconcileHandsFromScene(): void {
    const snapshot = seatStateStore.getSnapshot();
    if (!snapshot.inGame) return;
    engine.reconcileVisibleHands(snapshot.seats.map((seat) => {
      const equipmentIds = new Set(
        (seat.equipmentCards ?? []).map((card) => card.cardId).filter((cardId) => cardId > 0)
      );
      return {
        seatId: seat.seatId,
        cardIds: seat.knownCards
          .map((card) => card.cardId)
          .filter((cardId) => cardId > 0 && !equipmentIds.has(cardId))
      };
    }));
    reconnectNeedsHands = false;
  }

  /** 座位展示名：优先武将名（国战双将用「丨」连），读不到回落「N号位」。 */
  function readSeatLabel(seatId: number): string {
    const generalName = readSeatGeneralName(seatId);
    if (generalName) return generalName;
    const seat = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === seatId);
    const order = seat?.displayOrder ?? seatId + 1;
    const numeral = '一二三四五六七八'[Math.max(0, order - 1)];
    return `${numeral ?? order}号位`;
  }

  /** 从场景座位对象读武将名；主将副将都读不到就返回空串。 */
  function readSeatGeneralName(seatId: number): string {
    const scene = locateGameScene(window) as Record<string, unknown> | null;
    if (!scene) return '';
    const seatContainer = scene.seatContainer as { seatUIs?: unknown[] } | undefined;
    const seatUis = [scene.SelfSeatUi, ...(seatContainer?.seatUIs ?? [])]
      .filter((ui): ui is Record<string, unknown> => Boolean(ui) && typeof ui === 'object');
    const seatUi = seatUis.find((ui) => Number(ui.seatID) === seatId);
    const seat = seatUi?.seat as Record<string, unknown> | undefined;
    if (!seat) return '';
    const names: string[] = [];
    for (const key of ['General', 'general', 'General2', 'general2']) {
      const general = seat[key] as Record<string, unknown> | undefined;
      if (!general || typeof general !== 'object') continue;
      for (const nameKey of ['cardName', 'specifyName', 'trueSpecifyName', 'Name', 'name']) {
        const value = general[nameKey];
        if (typeof value === 'string' && value) {
          names.push(value);
          break;
        }
      }
    }
    return names.join('丨');
  }

  function isControlledSeat(seatId: number | null): boolean {
    if (seatId === null) return false;
    const snapshot = seatStateStore.getSnapshot();
    return seatId === snapshot.selfSeatId || snapshot.controlledSeatIds.includes(seatId);
  }

  /** 同区同主人：手牌 / 牌堆按展示鉴定处理；其它区返回 false 走正常移动。 */
  function applySameZoneShow(event: MoveCardEvent): boolean {
    const cardIds = event.cardIds.filter((cardId) => cardId > 0);
    if (event.fromZone === HAND_ZONE) {
      // MoveType 24：整手展示，未展示的已知牌不再在该手牌里。
      const wholeHand = event.moveType === WHOLE_HAND_SHOW_MOVE_TYPE && cardIds.length === event.cardCount;
      applyCardReveals([{
        zone: 'hand', ownerId: event.fromId, cardIds, position: 'unspecified', partial: !wholeHand
      }], engine, seatStateStore, `same-zone-show:${event.spellId}`);
      return true;
    }
    if (event.fromZone === DRAW_PILE_ZONE && event.fromId === DRAW_PILE_OWNER) {
      traceMingpai('reveal', {
        source: `same-zone-show:${event.spellId}`, zone: 'deck', ownerId: event.fromId,
        cardIds, position: event.toPosition
      });
      engine.observeKnownDrawPileCards(cardIds, event.toPosition);
      return true;
    }
    return false;
  }

  /**
   * 一次移牌。先丢掉半透明占位号，再按国战规则改牌堆顶底。
   * 同区展示不换主人；其余移动先把能确定的牌尽量补上，落位交给明牌引擎。
   */
  function handleCardsMoved(rawEvent: MoveCardEvent): void {
    if (rawEvent.fromZone === HAND_ZONE && rawEvent.toZone === HAND_ZONE) {
      const handMoveTrace = {
        spellId: rawEvent.spellId,
        moveType: rawEvent.moveType,
        fromId: rawEvent.fromId,
        toId: rawEvent.toId,
        cardCount: rawEvent.cardCount,
        cardIds: [...rawEvent.cardIds]
      };
      traceMingpai('hand-move-raw', handMoveTrace);
    }
    // 明牌专用纠偏：半透明卡号清空 + 牌堆顶/底纠偏。只影响明牌，不改总线原事件。
    // 开局从区外铺进牌堆的移牌交给管线处理：它只往牌堆里补未知占位槽位，不会记成明牌。
    const corrected = correctMoveCard(
      { ...rawEvent, srcSeatId: rawEvent.srcSeatId ?? null },
      {
        myId: seatStateStore.getSnapshot().selfSeatId,
        nationWar: isNationWarMode(seatStateStore.getSnapshot().mode),
        cardType,
        isRedCard,
        isJudgeRecoverySpell: (spellId) => spellId === JUDGE_RECOVERY_SPELL_ID || isJiaoyuSpell(spellId),
        zoneCardIds: (seatId, zone) => engine.getZoneCardIds(formatZoneId(seatId, zone)),
        handCardIds: (seatId) => {
          const seat = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === seatId);
          return seat?.knownCards.map((card) => card.cardId).filter((cardId) => cardId > 0) ?? [];
        }
      }
    );
    if (corrected.ignore) return;
    const event: MoveCardEvent = {
      ...rawEvent,
      cardIds: corrected.cardIds,
      fromPosition: corrected.fromPosition,
      toPosition: corrected.toPosition
    };
    if (isObfuscatedSameZoneShow({ ...event, srcSeatId: event.srcSeatId ?? null }) && applySameZoneShow(event)) {
      return;
    }

    movementSequence += 1;
    if (pendingQiTransfer && movementSequence > pendingQiTransfer.expiresAfterMovement) {
      pendingQiTransfer = null;
    }
    const preferredQiOwner = resolvePreferredQiOwner(event);
    // 暗牌只在牌堆顶/底按已记录的顺序补号。不用同技能线索或来源区里的其它明牌去猜。
    const pileCardIds = engine.resolveHiddenMovement(event, preferredQiOwner);
    const qiCardIds = takeQiDiscardCards(
      event,
      engine.getZoneCardIds(formatZoneId(DRAW_PILE_OWNER, DISCARD_ZONE)),
      (cardId) => engine.getOriginalOwnerSeatId(cardId),
      preferredQiOwner
    );
    const resolvedCardIds = qiCardIds
      ?? (pileCardIds.some((cardId) => cardId > 0) ? pileCardIds : [...event.cardIds]);
    const seat = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === event.fromId);
    const zoneKnown = event.fromZone === HAND_ZONE
      ? (seat?.knownCards.map((card) => card.cardId) ?? [])
      : [...engine.getZoneCardIds(formatZoneId(event.fromId, event.fromZone))];
    const zoneLength = event.fromZone === HAND_ZONE
      ? zoneKnown.filter((cardId) => cardId > 0).length + (seat?.unknownCardCount ?? 0)
      : zoneKnown.filter((cardId) => cardId > 0).length;
    const recoveredCardIds = takeHiddenZoneCards(
      { ...event, cardIds: resolvedCardIds },
      zoneKnown,
      zoneLength
    );
    const wholeHandDeparture = event.fromZone === HAND_ZONE
      && (event.cardCount === zoneLength || isAllianceWholeHandMove(event));
    const hiddenHandDeparture = event.fromZone === HAND_ZONE
      && !recoveredCardIds.some((cardId) => cardId > 0);
    traceMingpai('move', {
      spellId: event.spellId,
      moveType: event.moveType,
      from: [event.fromZone, event.fromId, rawEvent.fromPosition],
      to: [event.toZone, event.toId, event.toPosition],
      count: event.cardCount,
      rawIds: [...rawEvent.cardIds],
      resolvedIds: [...recoveredCardIds],
      remappedFromPosition: event.fromPosition !== rawEvent.fromPosition ? event.fromPosition : undefined
    });
    // 引擎落位。牌离开手牌时协议没公开身份就不能泄露，展示与标签仍按控制器解析结果；
    // 从技能临时区、处理区出来时这些牌本来就在明面上，直接用引擎的落位结果。
    const engineMovedCardIds = engine.applyMovement(
      event.spellId === SPELL_3483
        ? { ...event, pilePackCount: getObfuscated3483PileCount() }
        : event,
      recoveredCardIds
    );
    const appliedCardIds = event.fromZone !== HAND_ZONE && engineMovedCardIds.some((cardId) => cardId > 0)
      ? [...engineMovedCardIds]
      : recoveredCardIds;
    if (isXinyouCardGain({
      spellMatched: isXinyouSpell(event.spellId),
      toZone: event.toZone,
      toId: event.toId,
      srcSeatId: event.srcSeatId ?? null,
      casterSeatId: xinyouCaster && movementSequence <= xinyouCaster.expiresAfterMovement
        ? xinyouCaster.seatId
        : null
    })) {
      appliedCardIds.filter((cardId) => cardId > 0).forEach((cardId) => {
        engine.rememberPersistentCardTag(cardId, XINYOU_TAG);
      });
    }
    if (preferredQiOwner !== null && appliedCardIds.some((cardId) => cardId > 0)) {
      appliedCardIds.filter((cardId) => cardId > 0).forEach((cardId) => {
        engine.rememberPersistentCardTag(cardId, '炁', preferredQiOwner);
      });
      pendingQiTransfer = null;
      pendingQiDeath = null;
    }

    // 临时区进出时刷新 unknown 投影
    const known = appliedCardIds.filter((id) => id > 0);
    if (TEMPORARY_CARD_ZONES.has(event.toZone) && known.length) {
      engine.addZoneCardIds(MINGPAI_ZONE.UNKNOWN, known);
    }
    if (TEMPORARY_CARD_ZONES.has(event.fromZone) && known.length) {
      engine.removeZoneCardIds(MINGPAI_ZONE.UNKNOWN, known);
    }

    const sourceLabel = legacyIncomingHandLabel({
      spellId: event.spellId,
      moveType: event.moveType,
      fromZone: event.fromZone,
      toZone: event.toZone,
      fromId: event.fromId,
      toId: event.toId,
      selfSeatId: seatStateStore.getSnapshot().selfSeatId,
      seatLabel: readSeatLabel
    });
    if (sourceLabel) {
      appliedCardIds.filter((cardId) => cardId > 0).forEach((cardId) => {
        engine.rememberPersistentCardTag(cardId, sourceLabel);
      });
    }
    appliedCardIds.forEach((cardId) => {
      const persistentTags = engine.getPersistentTags(cardId);
      if (persistentTags.length) seatStateStore.setPersistentKnownCardTags(cardId, persistentTags);
    });
    seatStateStore.applyKnownHandMovement({
      cardCount: event.cardCount,
      cardIds: appliedCardIds,
      fromSeatId: event.fromId,
      fromZone: event.fromZone,
      toSeatId: event.toId,
      toZone: event.toZone
    });
    if (hiddenHandDeparture || wholeHandDeparture) {
      seatStateStore.applyHiddenHandMovement({
        fromSeatId: event.fromId,
        toSeatId: event.toZone === HAND_ZONE ? event.toId : null,
        wholeHand: wholeHandDeparture
      });
    }
  }

  function resetQiTransferState(): void {
    activeQiSeats.clear();
    eligibleQiKillersByVictim.clear();
    pendingQiDeath = null;
    pendingQiTransfer = null;
    xinyouCaster = null;
    movementSequence = 0;
    qiStateObserved = false;
  }

  function updateQiSeatState(seatId: number, value: number): void {
    qiStateObserved = true;
    if (value > 0) {
      activeQiSeats.add(seatId);
      return;
    }
    if (!activeQiSeats.has(seatId)) return;
    eligibleQiKillersByVictim.set(
      seatId,
      new Set([...activeQiSeats].filter((activeSeatId) => activeSeatId !== seatId))
    );
    activeQiSeats.delete(seatId);
  }

  function recordQiPlayerDeath(victimSeatId: number, killerSeatId: number | null): void {
    const eligible = !qiStateObserved
      || (activeQiSeats.has(victimSeatId)
        ? killerSeatId !== null && activeQiSeats.has(killerSeatId)
        : killerSeatId !== null
          && eligibleQiKillersByVictim.get(victimSeatId)?.has(killerSeatId) === true);
    if (!eligible) {
      pendingQiDeath = null;
      eligibleQiKillersByVictim.delete(victimSeatId);
      return;
    }
    pendingQiDeath = { victimSeatId, killerSeatId };
    eligibleQiKillersByVictim.delete(victimSeatId);
  }

  function recordQiTransferSpell(casterSeatId: number, targetSeatIds: readonly number[]): void {
    const uniqueTargets = [...new Set(targetSeatIds)].filter((seatId) => seatId !== casterSeatId);
    if (uniqueTargets.length !== 1) return;
    pendingQiTransfer = {
      originalOwnerSeatId: uniqueTargets[0],
      recipientSeatId: casterSeatId,
      expiresAfterMovement: movementSequence + 2
    };
  }

  function resolvePreferredQiOwner(event: TemporaryZoneMovement): number | null {
    const isHiddenDiscardToHand = event.fromZone === DISCARD_ZONE
      && event.toZone === HAND_ZONE
      && !event.cardIds.some((cardId) => cardId > 0);
    if (!isHiddenDiscardToHand) return null;
    if (pendingQiTransfer?.recipientSeatId === event.toId) {
      return pendingQiTransfer.originalOwnerSeatId;
    }
    if (pendingQiDeath
      && (pendingQiDeath.killerSeatId === null || pendingQiDeath.killerSeatId === event.toId)) {
      return pendingQiDeath.victimSeatId;
    }
    return null;
  }

  return {
    engine,
    dispose() {
      unsubscribe();
      unsubscribeSeatState();
      clearTempZoneGrids();
      resetQiTransferState();
    }
  };
}

const XINYOU_SKILL = { id: 'xinyou', title: '心幽', skillIds: [] as number[], spellNames: ['心幽'] };

/** 3571：判定牌按座位颜色回手。 */
const JUDGE_RECOVERY_SPELL_ID = 0xdf3;
/** 椒遇：同样按座位颜色把判定牌回手，颜色来自技能私有数据。 */
const JIAOYU_SKILL = { id: 'jiaoyu', title: '椒遇', skillIds: [] as number[], spellNames: ['椒遇'] };

function isJiaoyuSpell(spellId: number): boolean {
  if (!Number.isInteger(spellId) || spellId <= 0) return false;
  return resolveSkillIds(JIAOYU_SKILL, locateGameScene(window)).includes(spellId);
}

/** 谋周瑜醉锋：看别人的手牌，参数与固定名单里的看手牌技能同形。 */
const ZUIFENG_SKILL = { id: 'zuifeng', title: '醉锋', skillIds: [] as number[], spellNames: ['醉锋'] };

function isHandLookSpell(spellId: number): boolean {
  if (!Number.isInteger(spellId) || spellId <= 0) return false;
  return resolveSkillIds(ZUIFENG_SKILL, locateGameScene(window)).includes(spellId);
}

function isXinyouSpell(spellId: number): boolean {
  if (!Number.isInteger(spellId) || spellId <= 0) return false;
  return resolveSkillIds(XINYOU_SKILL, locateGameScene(window)).includes(spellId);
}

const QI_STATE_ID = 0xe92;
const QI_TRANSFER_SPELL_IDS = new Set([0xe92, 0xe93]);
/** 3483：手牌暂存到技能区后按 key 换回。 */
const SPELL_3483 = 0xd9b;
const WHOLE_HAND_SHOW_MOVE_TYPE = 24;

interface TemporaryZoneMovement {
  moveType?: number;
  cardCount: number;
  cardIds: readonly number[];
  fromId: number;
  fromZone: number;
  fromPosition: number;
  fromZoneParam: number;
  toId: number;
  toZone: number;
  toPosition: number;
  toZoneParam: number;
  spellId: number;
}

/** 缔盟先把双方整手牌分别放入各自的技能临时区，再从临时区交给对方。 */
function isAllianceWholeHandMove(
  movement: Pick<TemporaryZoneMovement, 'spellId' | 'moveType' | 'fromZone' | 'toZone'>
): boolean {
  return movement.spellId === 121 && movement.moveType === 11
    && movement.fromZone === HAND_ZONE
    && movement.toZone === 10;
}
