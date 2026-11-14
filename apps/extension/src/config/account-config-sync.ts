/**
 * 开关和小抄背景按游戏账号存到服务器，微端、浏览器、换电脑登录同一个账号都用这一份。
 *
 * 本机先存：改动马上写进本机，几秒内的改动合成一次再传，页面关掉前把还没传的发出去。
 * 读到账号后从服务器读一次，按每一项的改动时间合并，谁改得晚用谁，服务器上旧的不会盖掉本机刚改的。
 * 面板位置这类跟屏幕有关的项只存本机。上传的图片和视频只在上传的那台设备上有，服务器只记选的是哪一个。
 */

import { ACCOUNT_CONFIG_PATH, ACCOUNT_RESET_PATH } from '../const/account-config-endpoint.ts';
import {
  ACCOUNT_CONFIG_DOCUMENT_VERSION,
  ACCOUNT_CONFIG_LEDGER_KEY_BASE,
  ACCOUNT_CONFIG_UNSYNCED_SAVED_AT,
  ACCOUNT_RESET_TIMEOUT_MS,
  ACCOUNT_SYNC_PUSH_WAIT_MS,
  ACCOUNT_SYNC_RETRY_MS,
  DEVICE_ONLY_CONFIG_KEYS
} from '../const/account-sync.ts';
import { FNV1A_OFFSET_BASIS, FNV1A_PRIME, HASH_TEXT_RADIX } from '../const/text-hash.ts';
import {
  LEGACY_FAVORITES_SUFFIX,
  LEGACY_OFFICIAL_CHOICE_SUFFIX,
  LEGACY_PAPER_RESOURCE_SUFFIX,
  notifySkinBackgroundSynced,
  onSkinBackgroundDocumentPatched,
  patchSkinBackgroundDocument,
  readSkinBackgroundDocument,
  type OfficialBackgroundChoice
} from '../features/skin-background/skin-background-document.ts';
import {
  createSkinBackgroundStore,
  normalizeFavorite,
  type BackgroundFavorite,
  type BackgroundResource
} from '../features/skin-background/skin-background-store.ts';
import { readJson, removeStored, storageKeyForAccount, writeJson } from '../features/skin-background/skin-runtime.ts';
import { readAccountApi, usableAccount, writeAccountApi } from './account-api.ts';
import { CONFIG_SCHEMA, type XiaochaoConfig, type XiaochaoConfigKey } from './config-schema.ts';
import { CONFIG_CHANGE_EVENT, type ConfigChangeDetail, type XiaochaoConfigStore } from './config-store.ts';

type BackgroundStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const SECTIONS = ['settings', 'background'] as const;
type SyncSection = typeof SECTIONS[number];

const BACKGROUND_FIELDS = ['paperResource', 'favorites', 'officialChoice'] as const;
type BackgroundField = typeof BACKGROUND_FIELDS[number];

const SYNCED_CONFIG_KEYS = (Object.keys(CONFIG_SCHEMA) as XiaochaoConfigKey[])
  .filter((key) => !DEVICE_ONLY_CONFIG_KEYS.includes(key));

interface SyncEntry {
  value: unknown;
  savedAt: number;
}

type SectionEntries = Record<SyncSection, Record<string, SyncEntry>>;

/** 服务器上的那份。重置时间及以前改的项服务器已经删掉了。 */
interface RemoteState {
  entries: SectionEntries;
  resetAt: number;
}

interface RemoteBody {
  document?: unknown;
  resetAt?: unknown;
}

interface LedgerItem {
  hash: string;
  savedAt: number;
}

/** 本机每一项上次记下的内容摘要和改动时间，按账号存。 */
interface SyncLedger {
  items: Record<string, LedgerItem>;
  /** 有改动还没传上服务器。 */
  unpushed: boolean;
  /** 每记下一次改动加一，传完时用来判断传的过程中有没有新改动。 */
  revision: number;
}

interface LocalState {
  ledger: SyncLedger;
  entries: SectionEntries;
}

export interface AccountConfigSyncOptions {
  configStore: XiaochaoConfigStore;
  storage: BackgroundStorage | undefined;
}

export interface AccountConfigSync {
  /** 账号同步时调用：读到新账号就从服务器读一次，失败或没传上去的隔一会儿再试。 */
  checkAccount(): void;
  dispose(): void;
}

function emptyEntries(): SectionEntries {
  return { settings: {}, background: {} };
}

function savedAtOf(value: unknown): number {
  const savedAt = Number(value);
  return Number.isFinite(savedAt) && savedAt > 0 ? savedAt : 0;
}

function hashValue(value: unknown): string {
  const text = JSON.stringify(value ?? null);
  let hash = FNV1A_OFFSET_BASIS;
  for (let index = 0; index < text.length; index += 1) {
    hash = Math.imul(hash ^ text.charCodeAt(index), FNV1A_PRIME) >>> 0;
  }
  return `${text.length}:${hash.toString(HASH_TEXT_RADIX)}`;
}

function itemName(section: SyncSection, name: string): string {
  return `${section}/${name}`;
}

function defaultValueOf(section: SyncSection, name: string): unknown {
  if (section === 'settings') return CONFIG_SCHEMA[name as XiaochaoConfigKey]?.defaultValue;
  return name === 'favorites' ? [] : null;
}

function isDefaultValue(section: SyncSection, name: string, value: unknown): boolean {
  return hashValue(value) === hashValue(defaultValueOf(section, name));
}

function ledgerKey(account: string): string {
  return storageKeyForAccount(ACCOUNT_CONFIG_LEDGER_KEY_BASE, account);
}

function readLedger(storage: BackgroundStorage | undefined, account: string): SyncLedger {
  const raw = readJson<Partial<SyncLedger> | null>(storage, ledgerKey(account), null);
  const items: Record<string, LedgerItem> = {};
  if (raw?.items && typeof raw.items === 'object') {
    for (const [name, item] of Object.entries(raw.items)) {
      if (item && typeof item.hash === 'string') items[name] = { hash: item.hash, savedAt: savedAtOf(item.savedAt) };
    }
  }
  return { items, unpushed: raw?.unpushed === true, revision: Number(raw?.revision) || 0 };
}

function writeLedger(storage: BackgroundStorage | undefined, account: string, ledger: SyncLedger): void {
  writeJson(storage, ledgerKey(account), ledger);
}

function normalizeResource(value: unknown): Partial<BackgroundResource> | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const url = String(record?.url ?? '').trim();
  if (!url) return null;
  return {
    url,
    type: Number(record?.type) || 0,
    width: Number(record?.width) || 0,
    height: Number(record?.height) || 0
  };
}

function normalizeFavorites(value: unknown): BackgroundFavorite[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.map(normalizeFavorite).filter((item): item is BackgroundFavorite => {
    if (!item || seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function normalizeOfficialChoice(value: unknown): OfficialBackgroundChoice | null {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  const id = Number(record ? record.id : value);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return { id, savedAt: savedAtOf(record?.savedAt) };
}

/** 按功能读的顺序取本机的小抄背景：当前背景和官方背景先看单独的键，收藏先看账号文档。 */
function readLocalBackground(storage: BackgroundStorage | undefined, account: string): Record<BackgroundField, unknown> {
  const document = readSkinBackgroundDocument(storage, account);
  const store = createSkinBackgroundStore(storage, { resolveAccountId: () => account });
  return {
    paperResource: normalizeResource(store.loadResource()),
    favorites: store.favorites(),
    officialChoice: normalizeOfficialChoice(readJson<unknown>(storage, `${account}${LEGACY_OFFICIAL_CHOICE_SUFFIX}`, null))
      ?? normalizeOfficialChoice(document.officialChoice)
  };
}

/** 账号文档和功能单独读的键一起改，不然功能还会读到本机旧的那份。 */
function writeLocalBackground(
  storage: BackgroundStorage | undefined,
  account: string,
  fields: Partial<Record<BackgroundField, unknown>>
): void {
  const resource = 'paperResource' in fields ? normalizeResource(fields.paperResource) : undefined;
  const favorites = 'favorites' in fields ? normalizeFavorites(fields.favorites) : undefined;
  const officialChoice = 'officialChoice' in fields ? normalizeOfficialChoice(fields.officialChoice) : undefined;
  patchSkinBackgroundDocument(storage, account, {
    ...(resource !== undefined ? { paperResource: resource } : {}),
    ...(favorites !== undefined ? { favorites } : {}),
    ...(officialChoice !== undefined ? { officialChoice } : {}),
    silent: true
  });
  if (resource !== undefined) {
    const key = `${account}${LEGACY_PAPER_RESOURCE_SUFFIX}`;
    if (resource) writeJson(storage, key, resource);
    else removeStored(storage, key);
  }
  if (favorites !== undefined) writeJson(storage, `${account}${LEGACY_FAVORITES_SUFFIX}`, favorites);
  if (officialChoice !== undefined) {
    const key = `${account}${LEGACY_OFFICIAL_CHOICE_SUFFIX}`;
    if (officialChoice) writeJson(storage, key, officialChoice);
    else removeStored(storage, key);
  }
}

function remoteStateOf(body: RemoteBody | null | undefined): RemoteState {
  const entries = emptyEntries();
  const document = body?.document && typeof body.document === 'object' ? body.document as Record<string, unknown> : null;
  if (document && Number(document.version) === ACCOUNT_CONFIG_DOCUMENT_VERSION) {
    for (const section of SECTIONS) {
      const raw = document[section];
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
        if (!entry || typeof entry !== 'object' || !('value' in entry)) continue;
        const record = entry as Record<string, unknown>;
        entries[section][name] = { value: record.value, savedAt: savedAtOf(record.savedAt) };
      }
    }
  }
  return { entries, resetAt: savedAtOf(body?.resetAt) };
}

/** 没改过的默认值不传，服务器上没有这一项时各台设备本来就用默认值。 */
function documentOf(entries: SectionEntries): Record<string, unknown> {
  const document: Record<string, unknown> = { version: ACCOUNT_CONFIG_DOCUMENT_VERSION };
  for (const section of SECTIONS) {
    document[section] = Object.fromEntries(
      Object.entries(entries[section]).filter(([, entry]) => entry.savedAt > 0)
    );
  }
  return document;
}

interface Comparison {
  /** 要写进本机的项：服务器上改得更晚的，以及服务器重置以前本机改过、要改回默认的。 */
  changes: SectionEntries;
  /** 本机有服务器上没有、或者比服务器改得晚的项。 */
  localNewer: boolean;
}

function compare(local: SectionEntries, remote: RemoteState): Comparison {
  const changes = emptyEntries();
  let localNewer = false;
  for (const section of SECTIONS) {
    for (const [name, mine] of Object.entries(local[section])) {
      const theirs = remote.entries[section][name];
      if (theirs && theirs.savedAt > mine.savedAt) {
        changes[section][name] = theirs;
      } else if (mine.savedAt > remote.resetAt && (!theirs || mine.savedAt > theirs.savedAt)) {
        localNewer = true;
      } else if (!theirs && mine.savedAt > 0 && !isDefaultValue(section, name, mine.value)) {
        changes[section][name] = { value: defaultValueOf(section, name), savedAt: remote.resetAt };
      }
    }
  }
  return { changes, localNewer };
}

/** 启动后按账号和服务器同步开关和小抄背景。 */
export function startAccountConfigSync(options: AccountConfigSyncOptions): AccountConfigSync {
  const { configStore, storage } = options;
  let pulledAccount = '';
  let pulling = false;
  let pullRetryAt = 0;
  let pushing = false;
  let pushAgain = false;
  let pushRetryAt = 0;
  let pushTimer: ReturnType<typeof setTimeout> | undefined;
  let dirtySince: number | undefined;
  let applyingRemote = false;
  let disposed = false;

  function takeDirtySince(): number {
    const changedAt = dirtySince ?? Date.now();
    dirtySince = undefined;
    return changedAt;
  }

  /** 本机和上次记下的不一样的项记成 changedAt 改的。配置已经换成别的账号时返回空。 */
  function stampLocal(account: string, changedAt: number): LocalState | null {
    if (configStore.account() !== account) return null;
    const snapshot = configStore.snapshot();
    const values: Record<SyncSection, Record<string, unknown>> = {
      settings: Object.fromEntries(SYNCED_CONFIG_KEYS.map((key) => [key, snapshot[key]])),
      background: readLocalBackground(storage, account)
    };
    const ledger = readLedger(storage, account);
    const entries = emptyEntries();
    let ledgerChanged = false;
    for (const section of SECTIONS) {
      for (const [name, value] of Object.entries(values[section])) {
        const key = itemName(section, name);
        const hash = hashValue(value);
        let item = ledger.items[key];
        if (!item || item.hash !== hash) {
          // 头一回记的项是开始同步以前就有的：没改过的当最早，改过的只比默认值新。
          const savedAt = item ? changedAt : isDefaultValue(section, name, value) ? 0 : ACCOUNT_CONFIG_UNSYNCED_SAVED_AT;
          item = { hash, savedAt };
          ledger.items[key] = item;
          ledgerChanged = true;
          if (savedAt > 0) {
            ledger.unpushed = true;
            ledger.revision += 1;
          }
        }
        entries[section][name] = { value, savedAt: item.savedAt };
      }
    }
    if (ledgerChanged) writeLedger(storage, account, ledger);
    return { ledger, entries };
  }

  /** 把服务器上较新的项写进本机，记下它们在服务器上的改动时间，不算本机的改动。 */
  function applyRemote(account: string, state: LocalState, changes: SectionEntries): void {
    const settings: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(changes.settings)) {
      const parsed = CONFIG_SCHEMA[key as XiaochaoConfigKey]?.parse(entry.value);
      if (parsed === undefined) continue;
      settings[key] = parsed;
      state.ledger.items[itemName('settings', key)] = { hash: hashValue(parsed), savedAt: entry.savedAt };
    }
    const background: Partial<Record<BackgroundField, unknown>> = {};
    for (const field of BACKGROUND_FIELDS) {
      if (changes.background[field]) background[field] = changes.background[field].value;
    }
    const backgroundFields = Object.keys(background) as BackgroundField[];
    if (!Object.keys(settings).length && !backgroundFields.length) return;
    applyingRemote = true;
    try {
      configStore.setMany(settings as Partial<XiaochaoConfig>);
      if (backgroundFields.length) {
        writeLocalBackground(storage, account, background);
        const stored = readLocalBackground(storage, account);
        for (const field of backgroundFields) {
          state.ledger.items[itemName('background', field)] = {
            hash: hashValue(stored[field]),
            savedAt: changes.background[field].savedAt
          };
        }
      }
    } finally {
      applyingRemote = false;
    }
    writeLedger(storage, account, state.ledger);
    if (backgroundFields.length) notifySkinBackgroundSynced(account);
  }

  /** 合并服务器回来的那份。返回本机是不是还有比服务器新的项。 */
  function settle(account: string, remote: RemoteState, sentRevision?: number): boolean {
    const state = stampLocal(account, takeDirtySince());
    if (!state) return false;
    const comparison = compare(state.entries, remote);
    applyRemote(account, state, comparison.changes);
    const nothingNewSinceSent = sentRevision === undefined || state.ledger.revision === sentRevision;
    if (!comparison.localNewer && nothingNewSinceSent && state.ledger.unpushed) {
      state.ledger.unpushed = false;
      writeLedger(storage, account, state.ledger);
    }
    return comparison.localNewer;
  }

  async function pull(account: string): Promise<void> {
    const body = await readAccountApi<RemoteBody>(ACCOUNT_CONFIG_PATH, account);
    if (disposed || configStore.account() !== account) return;
    const localNewer = settle(account, remoteStateOf(body));
    pulledAccount = account;
    if (localNewer) pushCurrent(false);
  }

  async function push(account: string, pageClosing: boolean): Promise<void> {
    if (pushing) {
      pushAgain = true;
      return;
    }
    const state = stampLocal(account, takeDirtySince());
    if (!state || !state.ledger.unpushed) return;
    pushing = true;
    let localNewer = false;
    try {
      const body = await writeAccountApi<RemoteBody>(
        ACCOUNT_CONFIG_PATH,
        { account, document: documentOf(state.entries) },
        pageClosing
      );
      if (disposed) return;
      localNewer = settle(account, remoteStateOf(body), state.ledger.revision);
    } finally {
      pushing = false;
    }
    if (localNewer || pushAgain) {
      pushAgain = false;
      schedulePush();
    }
  }

  function cancelScheduledPush(): void {
    if (pushTimer === undefined) return;
    clearTimeout(pushTimer);
    pushTimer = undefined;
  }

  /** 这次会把到现在为止的改动都带上，之后的改动重新等几秒。 */
  function pushCurrent(pageClosing: boolean): void {
    cancelScheduledPush();
    const account = usableAccount(configStore.account());
    if (disposed || !account || account !== pulledAccount) return;
    push(account, pageClosing).catch(() => {
      pushRetryAt = Date.now() + ACCOUNT_SYNC_RETRY_MS;
    });
  }

  function schedulePush(): void {
    if (disposed || pushTimer !== undefined) return;
    pushTimer = setTimeout(() => pushCurrent(false), ACCOUNT_SYNC_PUSH_WAIT_MS);
  }

  function markDirty(): void {
    if (applyingRemote || disposed) return;
    dirtySince ??= Date.now();
    schedulePush();
  }

  const onConfigChange = (event: Event) => {
    const key = (event as CustomEvent<ConfigChangeDetail>).detail?.key;
    if (key && DEVICE_ONLY_CONFIG_KEYS.includes(key)) return;
    markDirty();
  };
  const stopBackgroundListen = onSkinBackgroundDocumentPatched(() => markDirty());
  const onPageHide = () => {
    if (pushTimer !== undefined) pushCurrent(true);
  };
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') onPageHide();
  };
  window.addEventListener(CONFIG_CHANGE_EVENT, onConfigChange);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibilityChange);

  return {
    checkAccount() {
      if (disposed) return;
      const account = usableAccount(configStore.account());
      if (!account) return;
      if (account !== pulledAccount) {
        if (pulling || Date.now() < pullRetryAt) return;
        pulling = true;
        pull(account).catch(() => {
          pullRetryAt = Date.now() + ACCOUNT_SYNC_RETRY_MS;
        }).finally(() => {
          pulling = false;
        });
        return;
      }
      if (pushRetryAt && Date.now() >= pushRetryAt) {
        pushRetryAt = 0;
        pushCurrent(false);
      }
    },
    dispose() {
      disposed = true;
      cancelScheduledPush();
      stopBackgroundListen();
      window.removeEventListener(CONFIG_CHANGE_EVENT, onConfigChange);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    }
  };
}

/**
 * 重置小抄时把当前账号存在服务器上的开关、背景和皮肤选择一起清掉，返回清没清成。
 * 服务器记下重置时间：别的设备上重置以前的改动传上来不算，读到之后也会改回默认。
 */
export async function resetAccountDataOnServer(accountId: string): Promise<boolean> {
  const account = usableAccount(accountId);
  if (!account) return true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error('服务器没有回话')), ACCOUNT_RESET_TIMEOUT_MS);
  });
  try {
    await Promise.race([writeAccountApi(ACCOUNT_RESET_PATH, { account, resetAt: Date.now() }), timeout]);
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}
