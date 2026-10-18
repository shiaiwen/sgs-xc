/** 王明山弹雀：自己座位状态 3433 是对照点数，手牌标与牌面点数的差。 */
export const TANQUE_STATE_ID = 0xd69;

export function tanqueDiffLabel(cardNumber: number, point: number): string | null {
  if (!(point > 0) || !Number.isFinite(cardNumber) || !cardNumber) return null;
  return `[弹雀] 差${Math.abs(cardNumber - point)}`;
}
