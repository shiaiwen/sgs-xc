/**
 * 技能辅助花色序列：把牌号收成花色点数记号，供面板展示。
 */

import type { GameCardCatalog } from '../cards/game-card-catalog.ts';

/** 把牌号收成花色加点数。 */
export function cardIdToSuitToken(
  cardId: number,
  gameCardCatalog: GameCardCatalog
): string {
  const card = gameCardCatalog.resolve(cardId);
  if (!card.suitGlyph && !card.rank) return '';
  return `${card.suitGlyph || ''}${card.rank || ''}`;
}

/** 往花色序列末尾追加一枚记号。 */
export function appendSuitToken(existing: readonly string[], token: string): string[] {
  const normalized = String(token || '').trim();
  if (!normalized) return [...existing];
  return [...existing, normalized];
}

/** 把花色记号解析回花色。 */
export function parseSuitToken(token: string): {
  glyph: string;
  rank: string;
  suitClass: string;
  isRed: boolean;
} {
  const match = String(token || '').match(/^([♥♦♠♣])(.*)$/);
  if (!match) {
    return { glyph: '', rank: token, suitClass: '', isRed: false };
  }
  const glyph = match[1];
  return {
    glyph,
    rank: match[2] || '',
    suitClass: glyph === '♥'
      ? 'suit-heart'
      : glyph === '♦'
        ? 'suit-diamond'
        : glyph === '♠'
          ? 'suit-spade'
          : glyph === '♣'
            ? 'suit-club'
            : '',
    isRed: glyph === '♥' || glyph === '♦'
  };
}
