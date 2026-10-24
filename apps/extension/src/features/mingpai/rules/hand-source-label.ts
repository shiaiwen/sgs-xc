/**
 * 手牌来源标记：只有别人也看得见牌面的牌才标短名。
 * 牌堆里暗着摸进手的不标。弃牌堆、处理区、装备区、判定展示区、技能临时区里的牌本来就朝上。
 * 原地亮出的牌，以及从别的座位手里拿走、结算时会亮给所有人的牌，也标。
 * 来源是别人的手牌时再带上座位名。读不到技能名就不标。
 */

import { readSpellName } from '../spell-name.ts';
import { HAND_LABEL_ALIASES } from './hand-label-aliases.ts';

/** 牌面本来就朝上的区域。1 是牌堆，5 是手牌，这两处默认别人看不见。 */
const PUBLIC_CARD_ZONES = new Set([2, 3, 6, 8, 10]);

export interface IncomingHandLabelInput {
  spellId: number;
  moveType: number;
  fromZone: number;
  toZone: number;
  /** 来源座位；来源是公共区时是 255。 */
  fromId?: number;
  toId: number;
  selfSeatId: number | null;
  /** 座位展示名，用于「来源是谁」。 */
  seatLabel?: (seatId: number) => string;
}

export function buildIncomingHandSourceLabel(input: IncomingHandLabelInput): string | null {
  if (!input.spellId || input.moveType >= 255) return null;
  const name = readSpellName(input.spellId);
  if (!name) return null;
  // 游戏自己会在牌上标这些技能，小抄不再画一遍。
  if (name === '巧织' || name === '制衡') return null;
  // 火攻亮出来的牌常常还停在原来的位置，不进新手牌。移动类型 0 也会被别处丢掉，这里仍要标。
  if (name === '火攻') return '[火攻]';
  if (input.toZone !== 5 || input.fromZone === 12) return null;
  if (input.moveType <= 0 && name !== '霸朝') return null;
  if (!cardFaceIsPublic(input) && !isShownHandover(input, name)) return null;
  const shortName = HAND_LABEL_ALIASES[name] ?? name.slice(0, 2);
  // 来源是另一个座位的手牌时标座位。霸朝交来的牌同样标是谁给的。
  const fromOtherSeat = input.fromId !== undefined
    && input.fromId !== 0xff
    && input.fromId !== input.toId
    && (input.fromZone === 5 || name === '霸朝');
  const source = fromOtherSeat ? input.seatLabel?.(input.fromId as number) ?? '' : '';
  return `[${shortName}]${source}`;
}

/** 别人看得到这张牌的牌面。牌堆里摸来的不在这里。 */
function cardFaceIsPublic(input: IncomingHandLabelInput): boolean {
  if (PUBLIC_CARD_ZONES.has(input.fromZone)) return true;
  if (input.fromZone !== 5 || input.fromId === undefined || input.fromId === 0xff) return false;
  // 原地亮出，或者从别的座位手里拿走并亮给所有人。
  return true;
}

/** 霸朝让别人交出一张牌，交出的那张会亮给所有人。从牌堆摸来的不算。 */
function isShownHandover(input: IncomingHandLabelInput, name: string): boolean {
  return name === '霸朝'
    && input.fromZone !== 1
    && input.fromId !== undefined
    && input.fromId !== 0xff
    && input.fromId !== input.toId;
}
