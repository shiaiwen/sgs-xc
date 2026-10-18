/** 双雄、吉占、权道的结果文案。纯函数，只读卡牌元数据。 */
import type { GameCardMetadata } from '../cards/game-card-catalog.ts';
import { compareRanks } from './point-calculators.ts';

type CardFace = Pick<GameCardMetadata, 'name' | 'suit' | 'suitGlyph' | 'rank' | 'cardType'>;

const TRICK_CARD_TYPE = 2;
const DELAYED_TRICK_PREFIXES = ['乐', '兵', '闪电'];
const SHA_NAMES = new Set(['杀', '火杀', '雷杀', '冰杀', '普通杀']);
const RANK_BY_LABEL: Record<string, number> = { A: 1, J: 11, Q: 12, K: 13 };

/** 把牌点收成可比较的数字。 */
export function rankNumber(card: Pick<GameCardMetadata, 'rank'>): number {
  return RANK_BY_LABEL[card.rank] ?? (Number.parseInt(card.rank, 10) || 0);
}

/** 生成双雄辅助文案。 */
export function formatShuangxiong(cards: readonly CardFace[]): string {
  const { red, black } = countRedBlack(cards);
  const advice = red > black ? '弃 黑' : red < black ? '弃 红' : '平';
  return `【双雄】${advice}\n${red}红 ${black}黑`;
}

/**
 * 曹金玉：先看查到的花色，没有花色时再用牌上的红黑标记。1 是红，2 是黑。
 */
export function formatCaojinyu(cards: readonly { suit: string; redBlack?: number }[]): string {
  let red = 0;
  let black = 0;
  for (const card of cards) {
    if (card.suit === 'heart' || card.suit === 'diamond') red += 1;
    else if (card.suit === 'spade' || card.suit === 'club') black += 1;
    else if (card.redBlack === 1) red += 1;
    else if (card.redBlack === 2) black += 1;
  }
  return `红 ${red}　黑 ${black}`;
}

function countRedBlack(cards: readonly CardFace[]): { red: number; black: number } {
  return {
    red: cards.filter((card) => card.suit === 'heart' || card.suit === 'diamond').length,
    black: cards.filter((card) => card.suit === 'spade' || card.suit === 'club').length
  };
}

/** 生成击战辅助文案。 */
export function formatJizhan(pivot: number, poolCards: readonly CardFace[]): string {
  const { greater, less, equal } = compareRanks(poolCards.map(rankNumber), pivot);
  return `【吉占】猜${greater > less ? '大' : '小'}\n跟${pivot}比，${greater}张大 ${less}张小 ${equal}平`;
}

/** 生成权道辅助文案。 */
export function formatQuandao(handCards: readonly CardFace[]): string {
  const sha = handCards.filter((card) => SHA_NAMES.has(card.name)).length;
  const tricks = handCards.filter((card) =>
    card.cardType === TRICK_CARD_TYPE
    && !DELAYED_TRICK_PREFIXES.some((prefix) => card.name.startsWith(prefix))).length;
  return `【权道】杀：普通锦囊\n${sha}：${tricks}`;
}
