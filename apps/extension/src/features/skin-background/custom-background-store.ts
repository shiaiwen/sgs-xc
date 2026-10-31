/**
 * 自定义背景图存在本机，每个登录账号一张。
 * 微端大文件走主进程磁盘；油猴/网页仍用 IndexedDB。
 */

import {
  assertCustomBackgroundMediaKind,
  blobForBackgroundPlayback,
  detectCustomBackgroundVideo,
  probeCustomBackgroundFile
} from './custom-background-media.ts';
import { accountStorageKey } from './skin-runtime.ts';

const DB_NAME = 'xiaochao-custom-background';
const STORE = 'background';
const LEGACY_KEY = 'current';
const DB_VERSION = 1;

export interface CustomBackgroundRecord {
  blob: Blob;
  active: boolean;
  updatedAt: number;
  /** IndexedDB 里 blob 可能没有 mime，恢复时用此标记区分视频。 */
  isVideo?: boolean;
  width?: number;
  height?: number;
  fileName?: string;
  mime?: string;
  /** 微端：正文在磁盘，IndexedDB 只留元数据。 */
  storage?: 'disk';
}

export interface CustomBackgroundActions {
  apply(record: CustomBackgroundRecord): Promise<void>;
  clear(): Promise<void>;
}

export interface CustomBackgroundStore {
  load(): Promise<CustomBackgroundRecord | null>;
  save(file: Blob): Promise<CustomBackgroundRecord>;
  setActive(active: boolean): Promise<void>;
  clear(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

interface CustomBackgroundDiskMeta {
  type?: string;
  isVideo?: boolean;
  width?: number;
  height?: number;
  fileName?: string;
  active?: boolean;
  updatedAt?: number;
}

type CustomBackgroundBridge = (operation: Record<string, unknown>) => Promise<unknown>;

export function isCustomBackgroundVideo(file: Blob, hint?: Pick<CustomBackgroundRecord, 'isVideo' | 'fileName'>): boolean {
  if (hint?.isVideo === true) return true;
  return detectCustomBackgroundVideo(file, hint?.fileName || (file instanceof File ? file.name : ''));
}

export function assertCustomBackgroundFile(file: Blob, fileName = ''): void {
  if (file.size <= 0) throw new Error('文件不能为空');
  assertCustomBackgroundMediaKind(file, fileName || (file instanceof File ? file.name : ''));
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打不开自定义背景存储'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('自定义背景读写失败'));
  });
}

function currentAccountKey(): string {
  let account = 'default';
  try {
    account = accountStorageKey(typeof localStorage === 'undefined' ? undefined : localStorage);
  } catch {
    account = 'default';
  }
  const safe = account.replace(/[^\w.@+-]/g, '_').slice(0, 64) || 'default';
  return `account:${safe}`;
}

function diskBridge(): CustomBackgroundBridge | null {
  const bridge = (globalThis as { xiaochaoStorage?: { customBackground?: CustomBackgroundBridge } }).xiaochaoStorage
    ?.customBackground;
  return typeof bridge === 'function' ? bridge : null;
}

function normalizeRecord(row: unknown, blob: Blob): CustomBackgroundRecord {
  const record = (row && typeof row === 'object' ? row : {}) as Partial<CustomBackgroundRecord>;
  const fileName = String(record.fileName || '');
  const isVideo = record.isVideo === true || isCustomBackgroundVideo(blob, { isVideo: record.isVideo, fileName });
  return {
    blob: blobForBackgroundPlayback(blob, isVideo, String(record.mime || '')),
    active: record.active !== false,
    updatedAt: Number(record.updatedAt) || 0,
    isVideo,
    width: Number(record.width) || undefined,
    height: Number(record.height) || undefined,
    fileName: fileName || undefined,
    mime: String(record.mime || blob.type || '') || undefined,
    storage: record.storage === 'disk' ? 'disk' : undefined
  };
}

export function createCustomBackgroundStore(): CustomBackgroundStore {
  const listeners = new Set<() => void>();
  let database: Promise<IDBDatabase> | null = null;
  let migrated = false;

  function db(): Promise<IDBDatabase> {
    database ??= openDb();
    return database;
  }

  async function migrateLegacy(): Promise<void> {
    if (migrated) return;
    migrated = true;
    const database = await db();
    const reading = database.transaction(STORE, 'readonly').objectStore(STORE);
    const legacy = await requestToPromise(reading.get(LEGACY_KEY));
    if (!legacy) return;
    const key = currentAccountKey();
    const existing = await requestToPromise(database.transaction(STORE, 'readonly').objectStore(STORE).get(key));
    const writing = database.transaction(STORE, 'readwrite').objectStore(STORE);
    const jobs = [requestToPromise(writing.delete(LEGACY_KEY))];
    if (!existing) jobs.unshift(requestToPromise(writing.put(legacy, key)));
    await Promise.all(jobs);
  }

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  async function readDiskRecord(accountKey: string, row: Partial<CustomBackgroundRecord>): Promise<CustomBackgroundRecord | null> {
    const bridge = diskBridge();
    if (!bridge) return null;
    const payload = await bridge({ action: 'get', accountKey }) as { buffer?: ArrayBuffer; meta?: CustomBackgroundDiskMeta } | null;
    if (!payload?.buffer) return null;
    const meta = payload.meta || {};
    const isVideo = meta.isVideo === true || row.isVideo === true;
    const blob = blobForBackgroundPlayback(
      new Blob([payload.buffer], { type: String(meta.type || row.mime || '') }),
      isVideo,
      String(meta.type || row.mime || '')
    );
    return normalizeRecord({ ...row, ...meta, storage: 'disk' }, blob);
  }

  async function load(): Promise<CustomBackgroundRecord | null> {
    await migrateLegacy();
    const account = currentAccountKey();
    const store = (await db()).transaction(STORE, 'readonly').objectStore(STORE);
    const row = await requestToPromise(store.get(account));
    if (!row || typeof row !== 'object') return null;
    const partial = row as Partial<CustomBackgroundRecord>;
    if (partial.storage === 'disk') return readDiskRecord(account, partial);
    if (!(partial.blob instanceof Blob)) return null;
    return normalizeRecord(partial, partial.blob);
  }

  return {
    load,
    async save(file) {
      const fileName = file instanceof File ? file.name : '';
      assertCustomBackgroundFile(file, fileName);
      const probed = file instanceof File ? await probeCustomBackgroundFile(file) : null;
      const isVideo = probed?.isVideo ?? isCustomBackgroundVideo(file, { fileName });
      const width = probed?.width;
      const height = probed?.height;
      const mime = probed?.mime || file.type || (isVideo ? 'video/mp4' : '');
      const playbackBlob = blobForBackgroundPlayback(file, isVideo, mime);
      const account = currentAccountKey();
      const bridge = diskBridge();
      const updatedAt = Date.now();
      if (bridge) {
        await bridge({
          action: 'put',
          accountKey: account,
          buffer: await playbackBlob.arrayBuffer(),
          meta: {
            type: mime,
            isVideo,
            width,
            height,
            fileName,
            active: true,
            updatedAt
          }
        });
        const record: CustomBackgroundRecord = {
          blob: playbackBlob,
          active: true,
          updatedAt,
          isVideo,
          width,
          height,
          fileName: fileName || undefined,
          mime: mime || undefined,
          storage: 'disk'
        };
        await migrateLegacy();
        const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
        await requestToPromise(store.put({
          active: true,
          updatedAt,
          isVideo,
          width,
          height,
          fileName,
          mime,
          storage: 'disk'
        }, account));
        notify();
        return record;
      }
      const record: CustomBackgroundRecord = {
        blob: playbackBlob,
        active: true,
        updatedAt,
        isVideo,
        width,
        height,
        fileName: fileName || undefined,
        mime: mime || undefined
      };
      await migrateLegacy();
      const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
      await requestToPromise(store.put(record, account));
      notify();
      return record;
    },
    async setActive(active) {
      const current = await load();
      if (!current) return;
      const account = currentAccountKey();
      const bridge = diskBridge();
      if (current.storage === 'disk' && bridge) {
        const existing = await bridge({ action: 'get', accountKey: account }) as {
          buffer?: ArrayBuffer;
          meta?: CustomBackgroundDiskMeta;
        } | null;
        if (existing?.buffer) {
          await bridge({
            action: 'put',
            accountKey: account,
            buffer: existing.buffer,
            meta: {
              ...(existing.meta || {}),
              active,
              updatedAt: current.updatedAt
            }
          });
        }
      }
      const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
      const row = await requestToPromise(store.get(account));
      const next = row && typeof row === 'object'
        ? { ...(row as Record<string, unknown>), active }
        : { active, updatedAt: Date.now(), isVideo: current.isVideo, storage: current.storage };
      await requestToPromise(store.put(next, account));
      notify();
    },
    async clear() {
      await migrateLegacy();
      const account = currentAccountKey();
      const bridge = diskBridge();
      if (bridge) await bridge({ action: 'remove', accountKey: account });
      const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
      await requestToPromise(store.delete(account));
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

let shared: CustomBackgroundStore | null = null;
let actions: CustomBackgroundActions | null = null;

export function getCustomBackgroundStore(): CustomBackgroundStore {
  shared ??= createCustomBackgroundStore();
  return shared;
}

export function bindCustomBackgroundActions(next: CustomBackgroundActions): () => void {
  actions = next;
  return () => {
    if (actions === next) actions = null;
  };
}

export async function applySavedCustomBackground(file: Blob): Promise<void> {
  const record = await getCustomBackgroundStore().save(file);
  if (!actions) throw new Error('背景还没准备好，稍后再试');
  await actions.apply(record);
}

export async function clearSavedCustomBackground(): Promise<void> {
  if (!actions) {
    await getCustomBackgroundStore().clear();
    return;
  }
  await actions.clear();
}
