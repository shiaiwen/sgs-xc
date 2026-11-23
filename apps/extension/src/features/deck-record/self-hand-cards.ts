import type { LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? (value as UnknownRecord) : null;
}

function cardIdFromHandUi(ui: unknown): number {
  const record = asRecord(ui);
  const card = asRecord(record?.Card) ?? asRecord(record?.theCard) ?? record;
  const cardId = Number(
    card?.CardId ?? card?.CardID ?? card?.cardId ?? card?.ID ?? 0
  );
  return cardId > 0 ? cardId : 0;
}

/** 读取本家手牌区当前展示的牌号，顺序与游戏手牌区一致。 */
export function readSelfHandCardIds(
  globalObject: LayaRuntimeWindow = typeof window !== 'undefined' ? (window as LayaRuntimeWindow) : ({} as LayaRuntimeWindow)
): number[] {
  const scene = locateGameScene(globalObject);
  const selfSeatUi = asRecord(scene?.SelfSeatUi) ?? asRecord(scene?.selfSeatUi);
  if (!selfSeatUi) return [];
  const container = asRecord(selfSeatUi.cardContainer);
  if (!container) return [];
  const handList = Array.isArray(container.handCardUis) && container.handCardUis.length
    ? container.handCardUis
    : container.cardUis ?? container.cardUIs;
  if (!Array.isArray(handList)) return [];
  const cardIds: number[] = [];
  for (const ui of handList) {
    const cardId = cardIdFromHandUi(ui);
    if (cardId > 0) cardIds.push(cardId);
  }
  return cardIds;
}