/**
 * 皮肤解锁里选好的皮肤按登录账号存到服务器，换浏览器或换电脑登录同一个账号也能带上。
 * 本机先写一份，几秒内的改动合成一次再传，页面关掉前把还没传的发出去。服务器连不上时照常用本机记录换肤。
 * 同一个武将两边都有记录时，谁保存得晚用谁。服务器重置以前存的记录不算数。
 */

import { readAccountApi, usableAccount, writeAccountApi } from '../../config/account-api.ts';
import { ACCOUNT_SKINS_PATH } from '../../const/account-config-endpoint.ts';
import { ACCOUNT_SYNC_PUSH_WAIT_MS, ACCOUNT_SYNC_RETRY_MS } from '../../const/account-sync.ts';

export interface SavedSkinChoice {
  skinID: number;
  isDynamic: boolean;
  /** 保存时的时间戳，毫秒。早先存的记录没有这一项，当作最早。 */
  savedAt?: number;
}

/** 按武将编号存的皮肤选择。 */
export type SavedSkinChoices = Record<string, SavedSkinChoice>;

export interface SkinChoiceSyncOptions {
  /** 当前游戏账号编号，没登录时为空。 */
  accountId: () => string;
  /** 皮肤解锁关着时不和服务器往来。 */
  enabled: () => boolean;
  read: (account: string) => SavedSkinChoices;
  write: (account: string, choices: SavedSkinChoices) => void;
  /** 服务器上的记录改了本机之后调用。 */
  onLocalUpdated?: () => void;
}

export interface SkinChoiceSync {
  /** 账号第一次出现时从服务器读一次。读或传失败后隔一会儿再读，读完把本机较新的记录传上去。 */
  checkAccount(): void;
  /** 本机刚保存过，稍等一下把整份传上去。 */
  schedulePush(account: string): void;
  dispose(): void;
}

interface SkinChoiceBody {
  skins?: unknown;
  resetAt?: unknown;
}

function savedAtOf(choice: { savedAt?: unknown } | undefined): number {
  const savedAt = Number(choice?.savedAt);
  return Number.isFinite(savedAt) && savedAt > 0 ? savedAt : 0;
}

/** 只留武将编号和皮肤编号都合法的记录。 */
function normalizeSkinChoices(value: unknown): SavedSkinChoices {
  const choices: SavedSkinChoices = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return choices;
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    const generalID = Number(key);
    const entry = raw && typeof raw === 'object' ? raw as Record<string, unknown> : null;
    const skinID = Number(entry?.skinID);
    if (!entry || !Number.isSafeInteger(generalID) || generalID <= 0) continue;
    if (!Number.isSafeInteger(skinID) || skinID < 0) continue;
    choices[String(generalID)] = {
      skinID,
      isDynamic: entry.isDynamic !== false,
      savedAt: savedAtOf(entry)
    };
  }
  return choices;
}

/** 去掉服务器重置那一刻及以前存的记录。 */
function withoutResetChoices(choices: SavedSkinChoices, resetAt: number): SavedSkinChoices {
  if (!(resetAt > 0)) return choices;
  return Object.fromEntries(Object.entries(choices).filter(([, choice]) => savedAtOf(choice) > resetAt));
}

/** incoming 里有没有 base 缺的、或者比 base 保存得晚的武将。 */
function hasNewerChoice(base: SavedSkinChoices, incoming: SavedSkinChoices): boolean {
  return Object.entries(incoming).some(([generalID, choice]) => (
    !base[generalID] || savedAtOf(choice) > savedAtOf(base[generalID])
  ));
}

function mergeSkinChoices(base: SavedSkinChoices, incoming: SavedSkinChoices): SavedSkinChoices {
  const merged = { ...base };
  for (const [generalID, choice] of Object.entries(incoming)) {
    if (!merged[generalID] || savedAtOf(choice) > savedAtOf(merged[generalID])) merged[generalID] = choice;
  }
  return merged;
}

export function createSkinChoiceSync(options: SkinChoiceSyncOptions): SkinChoiceSync {
  const pulledAccounts = new Set<string>();
  let pulling = false;
  let retryAt = 0;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAccount = '';
  let disposed = false;

  /** 服务器上比本机新的记录写进本机，重置以前的记录删掉，返回合并后的整份。 */
  function takeRemote(account: string, body: SkinChoiceBody | null): SavedSkinChoices {
    const local = normalizeSkinChoices(options.read(account));
    if (disposed) return local;
    const remote = normalizeSkinChoices(body?.skins);
    const kept = withoutResetChoices(local, savedAtOf({ savedAt: body?.resetAt }));
    const dropped = Object.keys(kept).length < Object.keys(local).length;
    if (!dropped && !hasNewerChoice(kept, remote)) return local;
    const merged = mergeSkinChoices(kept, remote);
    options.write(account, merged);
    options.onLocalUpdated?.();
    return merged;
  }

  async function push(account: string, pageClosing = false): Promise<void> {
    const body = await writeAccountApi<SkinChoiceBody | null>(
      ACCOUNT_SKINS_PATH,
      account,
      { skins: normalizeSkinChoices(options.read(account)) },
      pageClosing
    );
    takeRemote(account, body);
  }

  async function pull(account: string): Promise<void> {
    const body = await readAccountApi<SkinChoiceBody | null>(ACCOUNT_SKINS_PATH, account);
    const merged = takeRemote(account, body);
    if (!disposed && hasNewerChoice(normalizeSkinChoices(body?.skins), merged)) await push(account);
  }

  function retryLater(account: string): void {
    pulledAccounts.delete(account);
    retryAt = Date.now() + ACCOUNT_SYNC_RETRY_MS;
  }

  function pushPending(pageClosing: boolean): void {
    const next = pendingAccount;
    pendingAccount = '';
    if (next && !disposed) push(next, pageClosing).catch(() => retryLater(next));
  }

  const onPageHide = () => {
    if (pushTimer === undefined) return;
    clearTimeout(pushTimer);
    pushTimer = undefined;
    pushPending(true);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') onPageHide();
  };
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    checkAccount() {
      if (disposed || pulling || !options.enabled() || Date.now() < retryAt) return;
      const account = usableAccount(options.accountId());
      if (!account || pulledAccounts.has(account)) return;
      pulling = true;
      pull(account).then(() => {
        pulledAccounts.add(account);
      }, () => {
        retryLater(account);
      }).finally(() => {
        pulling = false;
      });
    },
    schedulePush(accountId) {
      const account = usableAccount(accountId);
      if (disposed || !account || !options.enabled()) return;
      pendingAccount = account;
      if (pushTimer !== undefined) return;
      pushTimer = setTimeout(() => {
        pushTimer = undefined;
        pushPending(false);
      }, ACCOUNT_SYNC_PUSH_WAIT_MS);
    },
    dispose() {
      disposed = true;
      if (pushTimer !== undefined) clearTimeout(pushTimer);
      pushTimer = undefined;
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}
