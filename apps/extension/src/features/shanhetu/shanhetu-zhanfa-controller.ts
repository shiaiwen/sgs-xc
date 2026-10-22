/**
 * 把神龙摆尾、三板斧、手到擒来、多多益善的次数写到自己座位的战法条上。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import type { GameEvent, GameEventBus } from '../../runtime/game-event-bus.ts';
import { isShanHeTuMode } from './shanhetu-shop-controller.ts';
import {
  createZhanfaCounts,
  noteAxeSha,
  noteDragonDraw,
  noteTurnSeat,
  noteZhanfaGameEnded,
  noteZhanfaGameStarted,
  zhanfaDisplayValue,
  type ZhanfaCounts
} from './shanhetu-zhanfa-count.ts';

type UnknownRecord = Record<string, unknown>;

export interface ShanhetuZhanfaCountOptions {
  globalObject: LayaRuntimeWindow;
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

function readZhanfaItems(locator: LayaObjectLocator): UnknownRecord[] {
  const scene = locator.gameScene() ?? locator.scene();
  const self = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  const items = self?.zhanFaItems ?? self?.ZhanFaItems;
  if (!Array.isArray(items)) return [];
  return items.map(asRecord).filter((item): item is UnknownRecord => item !== null);
}

function paint(items: readonly UnknownRecord[], state: ZhanfaCounts): void {
  for (const item of items) {
    const plotId = readPlotId(item);
    if (plotId === null) continue;
    const value = zhanfaDisplayValue(plotId, state);
    if (value === null) continue;
    item.Value = value;
  }
}

export function installShanhetuZhanfaCount(options: ShanhetuZhanfaCountOptions): () => void {
  const state = createZhanfaCounts();

  const onEvent = (event: GameEvent): void => {
    if (event.type === 'game-ended') {
      noteZhanfaGameEnded(state);
      return;
    }
    if (event.type === 'game-started') {
      noteZhanfaGameStarted(state, event.freshGame === true);
      return;
    }
    const selfSeatId = options.selfSeatId();
    if (event.type === 'turn-started' && event.seatIdKnown !== false) {
      if (noteTurnSeat(state, event.seatId, selfSeatId) && isShanHeTuMode(options.locator, options.globalObject)) {
        paint(readZhanfaItems(options.locator), state);
      }
      return;
    }
    if (!isShanHeTuMode(options.locator, options.globalObject)) return;
    const items = readZhanfaItems(options.locator);
    if (!items.length) return;
    let changed = false;
    if (event.type === 'cards-moved') {
      changed = noteDragonDraw(state, {
        selfSeatId,
        toId: event.toId,
        fromZone: event.fromZone,
        toZone: event.toZone,
        moveType: event.moveType,
        cardCount: event.cardCount
      });
    } else if (event.type === 'cards-used') {
      changed = noteAxeSha(state, {
        selfSeatId,
        seatId: event.seatId,
        source: event.source,
        useType: event.useType,
        spellId: event.spellId ?? null,
        isSend: event.isSend
      });
    }
    if (changed) paint(items, state);
  };

  return options.gameEvents.subscribe(onEvent);
}
