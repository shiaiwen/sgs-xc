import type { LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import {
  ANNIVERSARY_ASSIST_ACT_ID,
  ANNIVERSARY_BIND_POLL_MS,
  ANNIVERSARY_LIST_VERIFY_DIRECTIONS,
} from '../../const/anniversary-assist.ts';
import { ANNIVERSARY_LIST_VERIFY_MAX_PAGES } from '../../const/anniversary-assist-list.ts';
import type {
  AnniversaryAssistReceipt,
  AnniversaryAssistVerifyItem,
} from './anniversary-assist-types.ts';

type UnknownRecord = Record<string, unknown>;

function managerCtor(manager: UnknownRecord): UnknownRecord {
  return (manager.constructor ?? Object) as UnknownRecord;
}

function managerEventName(manager: UnknownRecord, name: string): string {
  const ctor = managerCtor(manager);
  const resolved = ctor[name];
  return typeof resolved === 'string' ? resolved : name;
}

function callManager<T>(manager: UnknownRecord, method: string, ...args: unknown[]): T | undefined {
  const fn = manager[method];
  if (typeof fn !== 'function') return undefined;
  try {
    return fn.call(manager, ...args) as T;
  } catch {
    return undefined;
  }
}

function sleep(ms: number, globalObject: LayaRuntimeWindow): Promise<void> {
  return new Promise((resolve) => globalObject.setTimeout(resolve, ms));
}

async function waitForListRefresh(
  manager: UnknownRecord,
  actId: number,
  direction: number,
  generation: unknown,
  nextCursor: unknown,
  firstPage: boolean,
  globalObject: LayaRuntimeWindow
): Promise<UnknownRecord | null> {
  const event = managerEventName(manager, 'LIST_CHANGE');
  const deadline = Date.now() + 16_000;
  while (Date.now() < deadline) {
    const resolved = await new Promise<UnknownRecord | null>((resolve) => {
      const onEvent = (...args: unknown[]) => {
        const eventActId = args[0];
        const eventDirection = args[1];
        if (eventActId !== actId || eventDirection !== direction) return;
        const state = callManager<UnknownRecord>(manager, 'GetListState', actId, direction);
        if (!state?.loaded || state.loading || state.refreshing) return;
        if (firstPage) {
          if (state.generation === generation) return;
        } else if (state.nextCursor === nextCursor && state.hasMore) {
          return;
        }
        cleanup();
        resolve(state);
      };
      const cleanup = () => {
        if (typeof manager.off === 'function') manager.off(event, manager, onEvent);
      };
      if (typeof manager.on !== 'function') {
        resolve(null);
        return;
      }
      manager.on(event, manager, onEvent);
      try {
        callManager(manager, 'RequestList', actId, direction, firstPage);
      } catch {
        cleanup();
        resolve(null);
      }
      globalObject.setTimeout(() => {
        cleanup();
        resolve(null);
      }, 16_000);
    });
    if (resolved) return resolved;
    await sleep(ANNIVERSARY_BIND_POLL_MS, globalObject);
  }
  return null;
}

function readListEntries(state: UnknownRecord): UnknownRecord[] {
  const list = state.list ?? state.items;
  return Array.isArray(list) ? list as UnknownRecord[] : [];
}

function readEntryAccountId(entry: UnknownRecord): string {
  return String(entry.otherUid ?? entry.otherUID ?? entry.accountId ?? '').trim();
}

function readEntryBindTime(entry: UnknownRecord, manager: UnknownRecord): number {
  const ctor = managerCtor(manager);
  const parser = ctor.ParseBindTime ?? ctor.parseBindTime;
  if (typeof parser === 'function') {
    try {
      const parsed = Number(parser.call(ctor, entry));
      if (Number.isFinite(parsed)) return parsed < 1_000_000_000_000 ? parsed * 1000 : parsed;
    } catch {
      // 走字段兜底。
    }
  }
  const raw = entry.bindTime ?? entry.BindTime ?? entry.time ?? entry.Time;
  const numeric = Number(raw);
  if (!Number.isFinite(numeric)) return Number.NaN;
  return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric;
}

async function verifyDirection(
  manager: UnknownRecord,
  direction: number,
  pending: Map<string, AnniversaryAssistVerifyItem>,
  guard: () => boolean,
  globalObject: LayaRuntimeWindow
): Promise<AnniversaryAssistReceipt[]> {
  const found: AnniversaryAssistReceipt[] = [];
  let firstPage = true;
  let pages = 0;
  const actId = ANNIVERSARY_ASSIST_ACT_ID;

  while (pending.size > 0 && guard() && pages < ANNIVERSARY_LIST_VERIFY_MAX_PAGES) {
    pages += 1;
    const snapshot = callManager<UnknownRecord>(manager, 'GetListState', actId, direction);
    const generation = snapshot?.generation;
    const nextCursor = snapshot?.nextCursor;
    const previousLength = readListEntries(snapshot ?? {}).length;
    const state = await waitForListRefresh(
      manager,
      actId,
      direction,
      generation,
      nextCursor,
      firstPage,
      globalObject
    );
    if (!state) break;

    const sliceStart = !firstPage && state.generation === generation ? previousLength : 0;
    for (const entry of readListEntries(state).slice(sliceStart)) {
      const accountId = readEntryAccountId(entry);
      const item = pending.get(accountId);
      if (!item) continue;
      const bindTime = readEntryBindTime(entry, manager);
      if (!Number.isFinite(bindTime) || bindTime < item.since || bindTime >= item.until) continue;
      found.push({
        id: item.id,
        otherAccountId: accountId,
        bindTime,
      });
      pending.delete(accountId);
    }

    if (!state.hasMore) {
      const totalCount = Number(state.totalCount);
      const listLength = readListEntries(state).length;
      if (state.hasMore === false && totalCount === listLength && guard()) {
        for (const item of pending.values()) {
          if (!item.checkMissing) continue;
          if (item.direction !== direction) continue;
          found.push({
            id: item.id,
            otherAccountId: item.otherAccountId,
            bindTime: 0,
            missing: true,
          });
          pending.delete(item.otherAccountId);
        }
      }
      break;
    }
    firstPage = false;
  }

  return found;
}

/** 按参考顺序先查帮出方向再查收到方向，只产出服务端下发的核验项对应凭据。 */
export async function verifyAnniversaryAssistItems(
  manager: UnknownRecord | null,
  items: AnniversaryAssistVerifyItem[],
  guard: () => boolean,
  globalObject: LayaRuntimeWindow
): Promise<AnniversaryAssistReceipt[]> {
  if (!manager || items.length === 0) return [];
  const pending = new Map<string, AnniversaryAssistVerifyItem>();
  for (const item of items) {
    const accountId = String(item.otherAccountId || '').trim();
    if (!accountId || !item.id) continue;
    pending.set(accountId, item);
  }
  if (pending.size === 0) return [];

  const receipts: AnniversaryAssistReceipt[] = [];
  for (const direction of ANNIVERSARY_LIST_VERIFY_DIRECTIONS) {
    const subset = new Map(
      [...pending.entries()].filter(([, item]) => item.direction === direction)
    );
    if (subset.size === 0) continue;
    const resolved = await verifyDirection(manager, direction, subset, guard, globalObject);
    receipts.push(...resolved);
    for (const receipt of resolved) pending.delete(receipt.otherAccountId);
  }
  return receipts;
}