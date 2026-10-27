/**
 * 把神龙摆尾、三板斧、手到擒来、多多益善的次数写到战法条 Value 上。
 */

import type { LayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import type { GameEvent, GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  createZhanfaCounts,
  noteCardUsed,
  noteDragonDraw,
  noteZhanfaGameEnded,
  noteZhanfaGameStarted,
  noteZhanfaNewDealTurn,
  noteZhanfaPhase0,
  noteZhanfaReady,
  zhanfaDisplayValue,
  type ZhanfaCounts
} from './shanhetu-zhanfa-count.ts';

type UnknownRecord = Record<string, unknown>;

export interface ShanhetuZhanfaCountOptions {
  locator: LayaObjectLocator;
  gameEvents: GameEventBus;
  selfSeatId: () => number | null;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function readPlotId(item: UnknownRecord): number | null {
  const raw = item.PlotID ?? item.plotID ?? item.plotId;
  const plotId = Number(raw);
  return Number.isInteger(plotId) ? plotId : null;
}

/** 参考脚本从 gamescene.zhanFaItems 取条；没有时再读 SelfSeatUi。 */
export function readZhanfaItems(locator: LayaObjectLocator): UnknownRecord[] {
  const scene = asRecord(locator.gameScene() ?? locator.scene());
  if (!scene) return [];
  const fromScene = scene.zhanFaItems ?? scene.ZhanFaItems;
  if (Array.isArray(fromScene) && fromScene.length) {
    return fromScene.map(asRecord).filter((item): item is UnknownRecord => item !== null);
  }
  const self = asRecord(scene.SelfSeatUi) ?? asRecord(scene.selfSeatUi);
  const fromSeat = self?.zhanFaItems ?? self?.ZhanFaItems;
  if (!Array.isArray(fromSeat)) return [];
  return fromSeat.map(asRecord).filter((item): item is UnknownRecord => item !== null);
}

export function paintZhanfaItems(items: readonly UnknownRecord[], state: ZhanfaCounts): void {
  for (const item of items) {
    const plotId = readPlotId(item);
    if (plotId === null) continue;
    const value = zhanfaDisplayValue(plotId, state);
    if (value === null) continue;
    item.Value = value;
    if (Object.prototype.hasOwnProperty.call(item, 'n')) item.n = value;
  }
}

export function installShanhetuZhanfaCount(options: ShanhetuZhanfaCountOptions): () => void {
  const state = createZhanfaCounts();
  let previousTurnCount = 0;

  const refresh = (): void => {
    const items = readZhanfaItems(options.locator);
    if (items.length) paintZhanfaItems(items, state);
  };

  const onEvent = (event: GameEvent): void => {
    if (event.type === 'game-ended') {
      noteZhanfaGameEnded(state);
      previousTurnCount = 0;
      refresh();
      return;
    }
    if (event.type === 'game-started') {
      noteZhanfaGameStarted(state, event.freshGame === true);
      previousTurnCount = 0;
      refresh();
      return;
    }
    if (event.type === 'card-list-ready') {
      noteZhanfaReady(state);
      refresh();
      return;
    }
    if (event.type === 'turn-started' && event.turnCount > 0) {
      if (noteZhanfaNewDealTurn(state, event.turnCount, previousTurnCount)) refresh();
      previousTurnCount = event.turnCount;
    }
    const selfSeatId = options.selfSeatId();
    let changed = false;
    if (event.type === 'phase-changed' && event.phase === 0) {
      changed = noteZhanfaPhase0(state, event.seatId, selfSeatId);
    } else if (event.type === 'cards-moved') {
      changed = noteDragonDraw(state, {
        selfSeatId,
        toId: event.toId,
        fromZone: event.fromZone,
        toZone: event.toZone,
        moveType: event.moveType,
        cardCount: event.cardCount
      });
    } else if (event.type === 'cards-used') {
      changed = noteCardUsed(state, {
        selfSeatId,
        seatId: event.seatId,
        useType: event.useType,
        spellId: event.spellId ?? null,
        isSend: event.isSend
      });
    }
    if (changed) refresh();
  };

  return options.gameEvents.subscribe(onEvent);
}
