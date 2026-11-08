/**
 * 皮肤/背景相关本地元数据：一个账号一个 JSON 文档，与微端 shared.json 里多 key 的用法对齐为单对象。
 * 上传的大文件仍在 custom-background-store，IndexedDB 或磁盘，不在此文档。
 */

import { readBrowserSetting } from '../../adapters/browser-settings.ts';
import type { BackgroundFavorite, BackgroundResource } from './skin-background-store.ts';
import { accountStorageKey, readJson, removeStored, writeJson } from './skin-runtime.ts';

export const SKIN_BACKGROUND_DOCUMENT_KEY_BASE = 'XC::skinBackground';
export const SKIN_BACKGROUND_DOCUMENT_VERSION = 1;

/** 旧版独立 localStorage 键后缀，迁移后删除。 */
export const LEGACY_PAPER_RESOURCE_SUFFIX = '::paperRes';
export const LEGACY_FAVORITES_SUFFIX = '::XC_SKIN_BACKGROUND_FAVORITES';
/** 旧版未带账号前缀时整键即为收藏列表。 */
export const LEGACY_FAVORITES_BARE_KEY = 'XC_SKIN_BACKGROUND_FAVORITES';
export const LEGACY_OFFICIAL_CHOICE_SUFFIX = '::XC_OFFICIAL_BACKGROUND_CHOICE';

export interface OfficialBackgroundChoice {
  id: number;
  savedAt: number;
}

export interface SkinBackgroundDocument {
  version: number;
  paperResource?: Partial<BackgroundResource>;
  favorites?: BackgroundFavorite[];
  /** 小抄背景里当前打勾的收藏。按账号存在这份文档里。 */
  selectedFavoriteId?: string;
  officialChoice?: OfficialBackgroundChoice | null;
  /** 写入时不通知远程同步。 */
  silent?: boolean;
}

type BackgroundStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

const documentListeners = new Set<(accountId: string, document: SkinBackgroundDocument) => void>();

/** 文档写入后通知。远程同步用这个把变更推到接口。 */
export function onSkinBackgroundDocumentPatched(
  listener: (accountId: string, document: SkinBackgroundDocument) => void
): () => void {
  documentListeners.add(listener);
  return () => {
    documentListeners.delete(listener);
  };
}

function notifySkinBackgroundDocumentPatched(accountId: string, document: SkinBackgroundDocument): void {
  for (const listener of documentListeners) {
    try {
      listener(accountId, document);
    } catch {
      // 同步失败不打断本地保存。
    }
  }
}

function safeAccountId(accountId: string): string {
  const safe = accountId.replace(/[^\w.@+-]/g, '_').slice(0, 64) || 'default';
  return safe;
}

function documentKey(accountId: string): string {
  return `${SKIN_BACKGROUND_DOCUMENT_KEY_BASE}::${safeAccountId(accountId)}`;
}

function emptyDocument(): SkinBackgroundDocument {
  return { version: SKIN_BACKGROUND_DOCUMENT_VERSION };
}

function parseDocument(raw: string | null): SkinBackgroundDocument | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as SkinBackgroundDocument;
    if (!value || typeof value !== 'object') return null;
    return value;
  } catch {
    return null;
  }
}

function readRawKey(storage: BackgroundStorage | undefined, key: string): string | null {
  const fromShared = readBrowserSetting(key);
  if (fromShared) return fromShared;
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function legacyResourceKeys(storage: BackgroundStorage | undefined, accountId: string): string[] {
  const keys: string[] = [];
  const seen = new Set<string>();
  const push = (key: string) => {
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  };
  push(`${accountId}${LEGACY_PAPER_RESOURCE_SUFFIX}`);
  if (accountId === 'default') {
    push(`default${LEGACY_PAPER_RESOURCE_SUFFIX}`);
  }
  for (const name of ['LastUserName', 'SGS_LASTLOGIN_ACCOUNT', 'SGS_LASTLOGIN_ACCOUNT1'] as const) {
    const account = readRawKey(storage, name)?.trim();
    if (account) push(`${account}${LEGACY_PAPER_RESOURCE_SUFFIX}`);
  }
  return keys;
}

function readLegacyPaperResource(
  storage: BackgroundStorage | undefined,
  accountId: string
): Partial<BackgroundResource> | undefined {
  for (const key of legacyResourceKeys(storage, accountId)) {
    try {
      const raw = readRawKey(storage, key);
      if (!raw) continue;
      const value = JSON.parse(raw) as Partial<BackgroundResource>;
      if (value && String(value.url || '').trim()) return value;
    } catch {
      // 忽略损坏的旧键。
    }
  }
  return undefined;
}

function parseLegacyFavoritesRaw(raw: unknown): BackgroundFavorite[] | undefined {
  const list = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown })?.items)
    ? (raw as { items: unknown[] }).items
    : null;
  return list ? list as BackgroundFavorite[] : undefined;
}

function readLegacyFavorites(
  storage: BackgroundStorage | undefined,
  accountId: string
): BackgroundFavorite[] | undefined {
  const keys = [
    `${accountId}${LEGACY_FAVORITES_SUFFIX}`,
    LEGACY_FAVORITES_BARE_KEY
  ];
  for (const key of keys) {
    const parsed = parseLegacyFavoritesRaw(readJson<unknown>(storage, key, null));
    if (parsed?.length) return parsed;
  }
  return undefined;
}

function readLegacyOfficialChoice(
  storage: BackgroundStorage | undefined,
  accountId: string
): OfficialBackgroundChoice | undefined {
  const key = `${accountId}${LEGACY_OFFICIAL_CHOICE_SUFFIX}`;
  const parsed = readJson<unknown>(storage, key, null);
  if (!parsed || typeof parsed !== 'object') return undefined;
  const id = Number((parsed as OfficialBackgroundChoice).id);
  if (!Number.isFinite(id) || id <= 0) return undefined;
  return {
    id,
    savedAt: Number((parsed as OfficialBackgroundChoice).savedAt) || Date.now()
  };
}

function removeLegacyKeys(storage: BackgroundStorage | undefined, accountId: string): void {
  for (const key of legacyResourceKeys(storage, accountId)) removeStored(storage, key);
  removeStored(storage, `${accountId}${LEGACY_FAVORITES_SUFFIX}`);
  removeStored(storage, LEGACY_FAVORITES_BARE_KEY);
  removeStored(storage, `${accountId}${LEGACY_OFFICIAL_CHOICE_SUFFIX}`);
}

/**
 * 扫一遍本地存储里所有旧版收藏键。
 * 旧版按账号名/客户端编号分别存过一份，当前账号对不上时也能把收藏捞回来。
 */
export function readAnyLegacyFavorites(storage: BackgroundStorage | undefined): BackgroundFavorite[] {
  const bag = storage as (BackgroundStorage & { length?: number; key?: (index: number) => string | null }) | undefined;
  if (!bag || typeof bag.key !== 'function' || typeof bag.length !== 'number') return [];
  const found: BackgroundFavorite[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < bag.length; index += 1) {
    const key = bag.key(index);
    if (!key || (key !== LEGACY_FAVORITES_BARE_KEY && !key.endsWith(LEGACY_FAVORITES_SUFFIX))) continue;
    const raw = readJson<unknown>(bag, key, null);
    const list = Array.isArray(raw) ? raw : Array.isArray((raw as { items?: unknown })?.items)
      ? (raw as { items: unknown[] }).items
      : [];
    for (const item of list) {
      const favorite = item as BackgroundFavorite;
      const id = String((favorite as { id?: unknown })?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      found.push(favorite);
    }
  }
  return found;
}

/**
 * 扫一遍本地存储里所有 `XC::skinBackground::<账号>` 文档。
 * 登录账号和游戏内编号不一定一致，收藏可能落在别的账号名下。
 */
export function readAnyDocumentFavorites(storage: BackgroundStorage | undefined): BackgroundFavorite[] {
  const bag = storage as (BackgroundStorage & { length?: number; key?: (index: number) => string | null }) | undefined;
  if (!bag || typeof bag.key !== 'function' || typeof bag.length !== 'number') return [];
  const prefix = `${SKIN_BACKGROUND_DOCUMENT_KEY_BASE}::`;
  const found: BackgroundFavorite[] = [];
  const seen = new Set<string>();
  for (let index = 0; index < bag.length; index += 1) {
    const key = bag.key(index);
    if (!key || !key.startsWith(prefix)) continue;
    const document = parseDocument(readRawKey(bag, key));
    for (const item of document?.favorites ?? []) {
      const favorite = item as BackgroundFavorite;
      const id = String((favorite as { id?: unknown })?.id ?? '');
      if (!id || seen.has(id)) continue;
      seen.add(id);
      found.push(favorite);
    }
  }
  return found;
}

/** 读取当前账号的皮肤背景文档，必要时从旧键迁移并写回单文档。 */
export function readSkinBackgroundDocument(storage: BackgroundStorage | undefined,
  accountId = accountStorageKey(storage)
): SkinBackgroundDocument {
  const key = documentKey(accountId);
  const existing = parseDocument(readRawKey(storage, key));
  if (existing && existing.version === SKIN_BACKGROUND_DOCUMENT_VERSION) {
    return existing;
  }

  const migrated: SkinBackgroundDocument = {
    version: SKIN_BACKGROUND_DOCUMENT_VERSION,
    paperResource: existing?.paperResource ?? readLegacyPaperResource(storage, accountId),
    favorites: existing?.favorites ?? readLegacyFavorites(storage, accountId),
    officialChoice: existing?.officialChoice ?? readLegacyOfficialChoice(storage, accountId) ?? null
  };

  const hadLegacy = Boolean(
    migrated.paperResource?.url
    || (migrated.favorites && migrated.favorites.length > 0)
    || migrated.officialChoice
  );
  if (hadLegacy || existing) {
    writeJson(storage, key, migrated);
    removeLegacyKeys(storage, accountId);
  }
  return migrated;
}

/** 合并写入文档字段，始终整份 JSON 写回一个键。 */
export function patchSkinBackgroundDocument(
  storage: BackgroundStorage | undefined,
  accountId: string,
    patch: Partial<Omit<SkinBackgroundDocument, 'version' | 'paperResource'>> & {
    /** null 表示这次主动清掉已设的图，避免旧图再盖回来。 */
    paperResource?: Partial<BackgroundResource> | null;
  }
): SkinBackgroundDocument {
  const current = readSkinBackgroundDocument(storage, accountId);
  const next: SkinBackgroundDocument = {
    version: SKIN_BACKGROUND_DOCUMENT_VERSION,
    paperResource: patch.paperResource === null
      ? undefined
      : patch.paperResource !== undefined
        ? patch.paperResource
        : current.paperResource,
    favorites: patch.favorites !== undefined ? patch.favorites : current.favorites,
    selectedFavoriteId: patch.selectedFavoriteId !== undefined ? patch.selectedFavoriteId : current.selectedFavoriteId,
    officialChoice: patch.officialChoice !== undefined ? patch.officialChoice : current.officialChoice
  };
  writeJson(storage, documentKey(accountId), next);
  if (!patch.silent) notifySkinBackgroundDocumentPatched(accountId, next);
  return next;
}

export function clearSkinBackgroundPaperResource(
  storage: BackgroundStorage | undefined,
  accountId = accountStorageKey(storage)
): void {
  const current = readSkinBackgroundDocument(storage, accountId);
  if (!current.paperResource?.url) return;
  patchSkinBackgroundDocument(storage, accountId, { paperResource: null });
}

export function readOfficialBackgroundChoice(
  storage: BackgroundStorage | undefined,
  accountId: string
): OfficialBackgroundChoice | null {
  const choice = readSkinBackgroundDocument(storage, accountId).officialChoice;
  if (!choice || !(choice.id > 0)) return null;
  return choice;
}

export function saveOfficialBackgroundChoice(
  storage: BackgroundStorage | undefined,
  accountId: string,
  id: number
): void {
  patchSkinBackgroundDocument(storage, accountId, {
    officialChoice: { id, savedAt: Date.now() }
  });
}
