/**
 * 账号配置按账号放到接口。开关、显示、屏蔽和背景在同一份里。
 * 本机仍先写一份，接口失败时不挡当前操作。浏览器和微端读同一份。
 */

import { CONFIG_CHANGE_EVENT } from '../../config/config-store.ts';
import {
  CONFIG_SCHEMA,
  type XiaochaoConfig,
  type XiaochaoConfigKey
} from '../../config/config-schema.ts';
import { WALLPAPER_OFFICIAL_CHOICE_SUFFIX } from '../../const/wallpaper-menu.ts';
import {
  onSkinBackgroundDocumentPatched,
  patchSkinBackgroundDocument,
  readSkinBackgroundDocument,
  type SkinBackgroundDocument
} from './skin-background-document.ts';
import { ACCOUNT_CONFIG_REMOTE_URL } from '../../const/account-config-endpoint.ts';
import { readJson, writeJson } from './skin-runtime.ts';

function defaultEndpoint(): string {
  const injected = typeof __XIAOCHAO_ACCOUNT_CONFIG_URL__ === 'string'
    ? __XIAOCHAO_ACCOUNT_CONFIG_URL__.trim()
    : '';
  return injected || ACCOUNT_CONFIG_REMOTE_URL;
}
const PUSH_WAIT_MS = 400;

type BackgroundStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface AccountConfigDocument {
  settings?: Partial<XiaochaoConfig>;
  background?: SkinBackgroundDocument;
}

export interface BackgroundConfigSyncOptions {
  storage: BackgroundStorage | undefined;
  accountId: () => string;
  settings: {
    snapshot: () => XiaochaoConfig;
    apply: (values: Partial<XiaochaoConfig>) => void;
  };
  endpoint?: string;
  fetcher?: typeof fetch;
  later?: (callback: () => void, delayMs: number) => void;
  /** 远程配置写进本机之后刷新界面上的勾。 */
  onApplied?: () => void;
}

function usableAccount(accountId: string): string {
  const account = accountId.trim();
  if (!account || account === 'default') return '';
  return account;
}

function officialKey(accountId: string): string {
  return `${accountId}${WALLPAPER_OFFICIAL_CHOICE_SUFFIX}`;
}

function withOfficialChoice(
  storage: BackgroundStorage | undefined,
  accountId: string,
  document: SkinBackgroundDocument
): SkinBackgroundDocument {
  if (document.officialChoice && document.officialChoice.id > 0) return document;
  const saved = readJson<{ id?: unknown; savedAt?: unknown } | number>(storage, officialKey(accountId), null);
  const id = Number(saved && typeof saved === 'object' ? saved.id : saved);
  if (!(id > 0)) return document;
  return {
    ...document,
    officialChoice: {
      id,
      savedAt: Number(saved && typeof saved === 'object' ? saved.savedAt : 0) || Date.now()
    }
  };
}

function currentDocument(
  storage: BackgroundStorage | undefined,
  accountId: string,
  settings: XiaochaoConfig
): AccountConfigDocument {
  return {
    settings,
    background: withOfficialChoice(storage, accountId, readSkinBackgroundDocument(storage, accountId))
  };
}

function settingsFromRemote(document: AccountConfigDocument | SkinBackgroundDocument): Partial<XiaochaoConfig> {
  const record = document as AccountConfigDocument;
  if (record.settings && typeof record.settings === 'object') return record.settings;
  return {};
}

function backgroundFromRemote(document: AccountConfigDocument | SkinBackgroundDocument): SkinBackgroundDocument | null {
  const record = document as AccountConfigDocument & SkinBackgroundDocument;
  if (record.background && typeof record.background === 'object') return record.background;
  if (record.paperResource || record.favorites || record.selectedFavoriteId) return record;
  return null;
}

function applyRemoteSettings(
  apply: (values: Partial<XiaochaoConfig>) => void,
  values: Partial<XiaochaoConfig>
): void {
  const next: Partial<XiaochaoConfig> = {};
  for (const key of Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[]) {
    const parsed = CONFIG_SCHEMA[key].parse(values[key]);
    if (parsed !== undefined) (next as Record<string, unknown>)[key] = parsed;
  }
  apply(next);
}

/**
 * 把接口的背景配置写进本机。官方背景的选择两边都有时，谁保存得晚用谁，
 * 不让接口上较早的那份把本机刚选的顶掉。返回 true 表示本机的更新，需要再传给接口。
 */
function applyRemoteDocument(
  storage: BackgroundStorage | undefined,
  accountId: string,
  document: SkinBackgroundDocument
): boolean {
  const local = withOfficialChoice(storage, accountId, readSkinBackgroundDocument(storage, accountId)).officialChoice;
  const remote = document.officialChoice && document.officialChoice.id > 0 ? document.officialChoice : null;
  const localId = local && local.id > 0 ? local.id : 0;
  const useRemote = Boolean(remote) && (!localId || Number(remote!.savedAt) > Number(local!.savedAt));
  const officialChoice = useRemote ? remote : (localId ? local : null);
  patchSkinBackgroundDocument(storage, accountId, {
    paperResource: document.paperResource,
    favorites: document.favorites,
    selectedFavoriteId: document.selectedFavoriteId,
    officialChoice,
    silent: true
  });
  if (useRemote) writeJson(storage, officialKey(accountId), remote);
  return Boolean(localId) && !useRemote && (!remote || remote.id !== localId);
}

/** 登录后拉取账号配置；本机改动再写回接口。开关和背景在同一份里。 */
export function startBackgroundConfigSync(options: BackgroundConfigSyncOptions): {
  pull: () => Promise<void>;
  stop: () => void;
} {
  const endpoint = options.endpoint || defaultEndpoint();
  const fetcher = options.fetcher || fetch;
  const later = options.later || ((callback, delayMs) => {
    setTimeout(callback, delayMs);
  });
  let applyingRemote = false;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  let pendingAccount = '';

  const pushNow = async (accountId: string) => {
    const account = usableAccount(accountId);
    if (!account) return;
    try {
      await fetcher(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          account,
          document: currentDocument(options.storage, account, options.settings.snapshot())
        })
      });
    } catch {
      // 接口不通时保留本机记录。
    }
  };

  const schedulePush = (accountId: string) => {
    if (applyingRemote) return;
    const account = usableAccount(accountId);
    if (!account) return;
    pendingAccount = account;
    if (pushTimer !== undefined) return;
    pushTimer = setTimeout(() => {
      pushTimer = undefined;
      const next = pendingAccount;
      pendingAccount = '';
      if (next) void pushNow(next);
    }, PUSH_WAIT_MS);
  };

  const pull = async () => {
    const account = usableAccount(options.accountId());
    if (!account) return;
    try {
      const response = await fetcher(`${endpoint}?account=${encodeURIComponent(account)}`);
      if (!response.ok) return;
      const body = await response.json() as { document?: AccountConfigDocument | null };
      if (body.document && typeof body.document === 'object') {
        applyingRemote = true;
        let localIsNewer = false;
        try {
          const background = backgroundFromRemote(body.document);
          if (background) localIsNewer = applyRemoteDocument(options.storage, account, background);
          applyRemoteSettings(options.settings.apply, settingsFromRemote(body.document));
        } finally {
          applyingRemote = false;
        }
        if (localIsNewer) schedulePush(account);
        later(() => {
          options.onApplied?.();
        }, 0);
        return;
      }
      await pushNow(account);
    } catch {
      // 读不到接口时继续用本机记录。
    }
  };

  const stopListen = onSkinBackgroundDocumentPatched((accountId) => {
    if (accountId !== options.accountId()) return;
    schedulePush(accountId);
  });
  const onSettingChange = () => {
    schedulePush(options.accountId());
  };
  if (typeof window !== 'undefined') {
    window.addEventListener(CONFIG_CHANGE_EVENT, onSettingChange);
  }
  later(() => {
    void pull();
  }, 0);

  return {
    pull,
    stop() {
      stopListen();
      if (typeof window !== 'undefined') {
        window.removeEventListener(CONFIG_CHANGE_EVENT, onSettingChange);
      }
      if (pushTimer !== undefined) clearTimeout(pushTimer);
    }
  };
}
