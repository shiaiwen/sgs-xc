/** 标注本家收到的牌原来属于谁，以及通过哪个技能取得。 */

import { EQUIP_ZONE, GLOBAL_OWNER, HAND_ZONE } from '../mingpai-engine.ts';
import { readSpellName } from '../spell-name.ts';
import { HAND_LABEL_ALIASES } from './hand-label-aliases.ts';

const SEAT_CARD_ZONES = new Set([HAND_ZONE, EQUIP_ZONE, 7]); // 7 是判定区。
const SNATCH_SPELL_ID = 4; // SHUNQIAN
const BACHAO_SPELL_IDS = new Set([3823, 3902]);
const BACHAO_NAME = /^霸朝(?:[·\d一二]+)?$/;

export interface IncomingHandLabelInput {
  spellId: number;
  /** 已由技能结算确认的名称，用于移牌消息没带技能号时。 */
  spellName?: string;
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

/** 别人交来的手牌即使没有亮给全场，移牌消息也明确交代了原持有者。 */
export function readIncomingCardOwner(
  input: Pick<IncomingHandLabelInput, 'fromId' | 'fromZone' | 'toId' | 'toZone' | 'selfSeatId'>
): number | null {
  const { fromId, fromZone, toId, toZone, selfSeatId } = input;
  if (toZone !== HAND_ZONE || toId !== selfSeatId || !SEAT_CARD_ZONES.has(fromZone)) return null;
  if (fromId === undefined || !Number.isInteger(fromId) || fromId < 0 || fromId >= GLOBAL_OWNER || fromId === toId) return null;
  return fromId;
}

export function isBachaoSpell(spellId: number): boolean {
  return BACHAO_SPELL_IDS.has(spellId) || BACHAO_NAME.test(readSpellName(spellId));
}

export function buildIncomingHandSourceLabel(
  input: IncomingHandLabelInput,
): string | null {
  if (input.moveType <= 0 || input.moveType >= 255 || input.toZone !== HAND_ZONE
    || input.toId !== input.selfSeatId || input.fromZone === 12) return null;
  const owner = readIncomingCardOwner(input);
  const name = input.spellName || readSpellName(input.spellId);
  let shortName = name.includes('特质') ? '特质' : HAND_LABEL_ALIASES[name] ?? name.slice(0, 2);
  if (input.spellId === SNATCH_SPELL_ID) shortName = '顺手';
  if (isBachaoSpell(input.spellId) || (input.spellName !== undefined && BACHAO_NAME.test(input.spellName))) {
    shortName = '霸朝';
  }
  const source = owner === null ? '' : input.seatLabel?.(owner) || `${owner + 1}号位`;
  return shortName || source ? `${shortName ? `[${shortName}]` : ''}${source}` : null;
}
