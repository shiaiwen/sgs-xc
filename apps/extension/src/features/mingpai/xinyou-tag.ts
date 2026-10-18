/**
 * 谢灵毓「心幽」标签。
 * 只标记她通过该技能拿到手的牌。结束阶段、回合结束，或下一位开始时去掉。
 * 她交出去的牌不标记。
 */

export const XINYOU_TAG = '心幽';
const HAND_ZONE = 5;
/** 0 是下一位的回合开始。6 是结束阶段。这两处都要去掉心幽，跟有没有真正弃牌无关。 */
const TURN_START_PHASE = 0;
const END_PHASE = 6;

/**
 * 本回合的心幽标记应清除。
 * 结束阶段及之后会清。有人直接结束回合、跳过结束阶段时，下一位回合开始也清。
 */
export function xinyouTagExpires(phase: number): boolean {
  return Number.isInteger(phase) && (phase === TURN_START_PHASE || phase >= END_PHASE);
}

/** 角色数据首项是这个数时，后面带的是心幽牌。8 写入，9 清空。 */
const XINYOU_ROLE_TOKEN = 4016;

/**
 * 从角色数据里读出这一座位当前的心幽牌。
 * 不是这条数据时返回 null。9 或张数为 0 时返回空列表，表示标记应消失。
 */
export function readXinyouRoleCards(input: {
  isSend: boolean;
  dataId: number;
  datas: readonly unknown[];
}): number[] | null {
  if (input.isSend || (input.dataId !== 8 && input.dataId !== 9)) return null;
  const datas = input.datas.map((value) => Number(value));
  if (datas[0] !== XINYOU_ROLE_TOKEN) return null;
  if (input.dataId === 9) return [];
  const count = datas[2];
  if (!Number.isInteger(count) || count < 0 || datas.length < 3 + count) return null;
  if (count === 0) return [];
  return datas.slice(3, 3 + count).filter((cardId) => Number.isInteger(cardId) && cardId > 0);
}

/**
 * 这次移牌是不是心幽获得的手牌。
 * 知道发动者时，只有进入发动者手牌才算；她交给别人的牌不算。
 */
export function isXinyouCardGain(input: {
  spellMatched: boolean;
  toZone: number;
  toId: number;
  srcSeatId: number | null;
  casterSeatId: number | null;
}): boolean {
  if (!input.spellMatched || input.toZone !== HAND_ZONE) return false;
  if (input.casterSeatId !== null) return input.toId === input.casterSeatId;
  return input.srcSeatId === null || input.srcSeatId === input.toId;
}
