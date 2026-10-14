/**
 * 手牌来源标记：牌进手牌时按技能名取前两字，来源是别人的手牌时再带上座位名。
 * 条件：牌进手牌、不是回收区、目标是自己、技能号存在、移动类型在 1 和 255 之间。
 * 读不到技能名就不标。
 */

import { readSpellName } from '../spell-name.ts';

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

export function legacyIncomingHandLabel(input: IncomingHandLabelInput): string | null {
  if (input.toZone !== 5 || input.fromZone === 12) return null;
  if (input.selfSeatId === null || input.toId !== input.selfSeatId) return null;
  if (!input.spellId || input.moveType <= 1 || input.moveType >= 255) return null;
  const name = readSpellName(input.spellId);
  if (!name) return null;
  const shortName = name.slice(0, 2);
  // 来源是别人的手牌（不是公共区、也不是自己）时才标来源座位。
  const fromOtherHand = input.fromZone === 5
    && input.fromId !== undefined
    && input.fromId !== 0xff
    && input.fromId !== input.selfSeatId;
  const source = fromOtherHand ? input.seatLabel?.(input.fromId as number) ?? '' : '';
  return `[${shortName}]${source}`;
}
