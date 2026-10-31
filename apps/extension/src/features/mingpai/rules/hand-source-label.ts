/**
 * 手牌来源标记：牌进手牌时用短名，表里没有的技能取名字前两个字。来源是别人的手牌时再带上座位名。
 * 条件：牌进任意座位的手牌、不是回收区、技能号存在、移动类型不是 0 也不是 255。顺手这类普通移动也标。
 * 别人的明牌条上也要能看到这几个字，不能只标自己拿到的牌。
 * 读不到技能名就不标。
 */

import { GLOBAL_OWNER } from '../mingpai-engine.ts';
import { readSpellName } from '../spell-name.ts';
import { HAND_LABEL_ALIASES } from './hand-label-aliases.ts';

export interface IncomingHandLabelInput {
  spellId: number;
  moveType: number;
  fromZone: number;
  toZone: number;
  /** 来源座位；来源是公共区时用 GLOBAL_OWNER。 */
  fromId?: number;
  toId: number;
  selfSeatId: number | null;
  /** 座位展示名，用于「来源是谁」。 */
  seatLabel?: (seatId: number) => string;
}

export function buildIncomingHandSourceLabel(
  input: IncomingHandLabelInput,
): string | null {
  if (!input.spellId || input.moveType >= 255) return null;
  const name = readSpellName(input.spellId);
  if (!name) return null;
  // 对于别人都不是明牌所以不标来源。

  const skipNames = ['巧织', '制衡', '采风', '茂著','顾曲','尽览'];
  if (skipNames.includes(name)) return null;
  // 火攻亮出来的牌常常还停在原来的位置，不进新手牌。移动类型 0 也会被别处丢掉，这里仍要标。
  if (input.toZone !== 5 || input.fromZone === 12) {
    return name === '火攻' ? '[火攻]' : null;
  }
  if (input.moveType <= 0 && name !== '火攻' && name !== '霸朝') return null;
  const shortName = HAND_LABEL_ALIASES[name] ?? name.slice(0, 2);
  // 来源是另一个座位的手牌时标座位。霸朝从装备区交来的牌同样标是谁给的。
  const fromOtherSeat =
    input.fromId !== undefined &&
    input.fromId !== GLOBAL_OWNER &&
    input.fromId !== input.toId &&
    (input.fromZone === 5 || name === '霸朝');
  const source = fromOtherSeat
    ? (input.seatLabel?.(input.fromId as number) ?? '')
    : '';
  return `[${shortName}]${source}`;
}
