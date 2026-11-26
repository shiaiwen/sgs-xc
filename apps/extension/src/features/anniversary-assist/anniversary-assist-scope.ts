import { ANNIVERSARY_ASSIST_ACT_ID } from '../../const/anniversary-assist.ts';
import { gameLoginAccountOf, resolveGameAccountId } from '../../runtime/game-account-session.ts';

export type AnniversaryLedgerScope = {
  actId: number;
  gameUserId: string;
  loginAccount: string;
  scopeKey: string;
};

export function buildAnniversaryLedgerScope(gameUserId: string): AnniversaryLedgerScope | null {
  const trimmedUserId = String(gameUserId || '').trim();
  if (!trimmedUserId || trimmedUserId === '0') return null;
  const loginAccount = gameLoginAccountOf(trimmedUserId);
  if (!loginAccount) return null;
  const scopeKey = `${ANNIVERSARY_ASSIST_ACT_ID}:${loginAccount}:${trimmedUserId}`;
  return {
    actId: ANNIVERSARY_ASSIST_ACT_ID,
    gameUserId: trimmedUserId,
    loginAccount,
    scopeKey,
  };
}

export function resolveAnniversaryLedgerScope(
  globalObject: Window & typeof globalThis
): AnniversaryLedgerScope | null {
  const gameUserId = resolveGameAccountId(globalObject);
  if (!gameUserId) return null;
  return buildAnniversaryLedgerScope(gameUserId);
}