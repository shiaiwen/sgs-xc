/**
 * 上传的背景图片、视频存在本机，按账号分，每个文件一个编号。
 * 微端大文件走主进程磁盘；油猴/网页存 IndexedDB。
 * 列表、当前背景只记 `xc-upload:<编号>`，用的时候再按编号读出文件。
 */

import {
  assertBackgroundMediaFile,
  blobForBackgroundPlayback,
  detectBackgroundVideoFile,
  probeBackgroundFile
} from './background-media-file.ts';
import type { LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { resolveGameAccountId } from '../../runtime/game-account-session.ts';
import { safeAccountKeyPart } from './skin-runtime.ts';
import { UPLOADED_BACKGROUND_ACCOUNT_KEY_PREFIX } from '../../const/account-storage.ts';
import { UPLOADED_BACKGROUND_FILE_KEY_SEPARATOR } from '../../const/uploaded-background.ts';

/** 数据库名和微端磁盘接口名沿用已存数据的名字，改了就读不到用户已上传的文件。 */
const DB_NAME = 'xiaochao-custom-background';
const STORE = 'background';
const DB_VERSION = 1;

export interface UploadedBackgroundFile {
  id: string;
  isVideo: boolean;
  width: number;
  height: number;
  mime: string;
  fileName: string;
}

/** 早先每个账号只存一份的上传背景，读出来转成列表里的一项。 */
export interface LegacyUploadedBackground {
  file: UploadedBackgroundFile;
  /** 当时是不是正在用。 */
  active: boolean;
}

export interface UploadedBackgroundStore {
  save(file: File): Promise<UploadedBackgroundFile>;
  load(id: string): Promise<Blob | null>;
  remove(id: string): Promise<void>;
  /** 把这个账号早先那份上传背景改存成一个编号，旧记录删掉。没有就返回空。 */
  takeLegacy(): Promise<LegacyUploadedBackground | null>;
  clearAll(): Promise<void>;
}

interface UploadedBackgroundMeta {
  type?: string;
  mime?: string;
  isVideo?: boolean;
  width?: number;
  height?: number;
  fileName?: string;
  active?: boolean;
  updatedAt?: number;
  storage?: 'disk';
}

interface UploadedBackgroundRow extends UploadedBackgroundMeta {
  blob?: Blob;
}

type DiskBridge = (operation: Record<string, unknown>) => Promise<unknown>;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('打不开背景文件存储'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('背景文件读写失败'));
  });
}

/** 按游戏账号编号分。编号读不到时返回空，这时不读也不写。 */
function currentAccountKey(): string {
  try {
    const safe = safeAccountKeyPart(resolveGameAccountId(globalThis as LayaRuntimeWindow));
    return safe ? `${UPLOADED_BACKGROUND_ACCOUNT_KEY_PREFIX}${safe}` : '';
  } catch {
    return '';
  }
}

function fileKey(accountKey: string, id: string): string {
  return accountKey && id ? `${accountKey}${UPLOADED_BACKGROUND_FILE_KEY_SEPARATOR}${id}` : '';
}

function diskBridge(): DiskBridge | null {
  const bridge = (globalThis as { xiaochaoStorage?: { customBackground?: DiskBridge } }).xiaochaoStorage
    ?.customBackground;
  return typeof bridge === 'function' ? bridge : null;
}

function newUploadId(): string {
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function rowMime(row: UploadedBackgroundMeta, isVideo: boolean): string {
  return String(row.mime || row.type || '') || (isVideo ? 'video/mp4' : 'image/png');
}

export function createUploadedBackgroundStore(): UploadedBackgroundStore {
  let database: Promise<IDBDatabase> | null = null;

  function db(): Promise<IDBDatabase> {
    database ??= openDb();
    return database;
  }

  async function readRow(key: string): Promise<UploadedBackgroundRow | null> {
    const store = (await db()).transaction(STORE, 'readonly').objectStore(STORE);
    const row = await requestToPromise(store.get(key));
    return row && typeof row === 'object' ? row as UploadedBackgroundRow : null;
  }

  async function writeRow(key: string, row: UploadedBackgroundRow): Promise<void> {
    const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
    await requestToPromise(store.put(row, key));
  }

  async function deleteRow(key: string): Promise<void> {
    const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
    await requestToPromise(store.delete(key));
  }

  /** 读出文件本体和说明。微端的本体在磁盘上，IndexedDB 只留说明。 */
  async function readFile(key: string): Promise<{ blob: Blob; meta: UploadedBackgroundMeta } | null> {
    const row = await readRow(key);
    if (!row) return null;
    if (row.storage === 'disk') {
      const bridge = diskBridge();
      if (!bridge) return null;
      const payload = await bridge({ action: 'get', accountKey: key }) as { buffer?: ArrayBuffer; meta?: UploadedBackgroundMeta } | null;
      if (!payload?.buffer) return null;
      const meta = { ...row, ...(payload.meta || {}) };
      const isVideo = meta.isVideo === true;
      const mime = rowMime(meta, isVideo);
      return { blob: blobForBackgroundPlayback(new Blob([payload.buffer], { type: mime }), isVideo, mime), meta };
    }
    if (!(row.blob instanceof Blob)) return null;
    const isVideo = row.isVideo === true || detectBackgroundVideoFile(row.blob, String(row.fileName || ''));
    return { blob: blobForBackgroundPlayback(row.blob, isVideo, rowMime(row, isVideo)), meta: { ...row, isVideo } };
  }

  async function writeFile(key: string, blob: Blob, meta: UploadedBackgroundMeta): Promise<void> {
    const bridge = diskBridge();
    if (bridge) {
      await bridge({ action: 'put', accountKey: key, buffer: await blob.arrayBuffer(), meta: { ...meta, type: meta.mime } });
      await writeRow(key, { ...meta, storage: 'disk' });
      return;
    }
    await writeRow(key, { ...meta, blob });
  }

  async function removeFile(key: string): Promise<void> {
    const bridge = diskBridge();
    if (bridge) await bridge({ action: 'remove', accountKey: key });
    await deleteRow(key);
  }

  return {
    async save(file) {
      assertBackgroundMediaFile(file, file.name);
      if (file.size <= 0) throw new Error('文件不能为空');
      const accountKey = currentAccountKey();
      if (!accountKey) throw new Error('还没读到游戏账号，进大厅后再上传');
      const probed = await probeBackgroundFile(file);
      const id = newUploadId();
      const mime = probed.mime;
      const meta: UploadedBackgroundMeta = {
        mime,
        isVideo: probed.isVideo,
        width: probed.width,
        height: probed.height,
        fileName: file.name,
        updatedAt: Date.now()
      };
      await writeFile(fileKey(accountKey, id), blobForBackgroundPlayback(file, probed.isVideo, mime), meta);
      return { id, isVideo: probed.isVideo, width: probed.width, height: probed.height, mime, fileName: file.name };
    },
    async load(id) {
      const key = fileKey(currentAccountKey(), id);
      if (!key) return null;
      return (await readFile(key))?.blob ?? null;
    },
    async remove(id) {
      const key = fileKey(currentAccountKey(), id);
      if (key) await removeFile(key);
    },
    async takeLegacy() {
      const accountKey = currentAccountKey();
      if (!accountKey) return null;
      const legacy = await readFile(accountKey);
      if (!legacy) {
        if (await readRow(accountKey)) await removeFile(accountKey);
        return null;
      }
      const isVideo = legacy.meta.isVideo === true;
      const id = newUploadId();
      const file: UploadedBackgroundFile = {
        id,
        isVideo,
        width: Number(legacy.meta.width) || 0,
        height: Number(legacy.meta.height) || 0,
        mime: rowMime(legacy.meta, isVideo),
        fileName: String(legacy.meta.fileName || '')
      };
      await writeFile(fileKey(accountKey, id), legacy.blob, {
        mime: file.mime,
        isVideo,
        width: file.width,
        height: file.height,
        fileName: file.fileName,
        updatedAt: Number(legacy.meta.updatedAt) || Date.now()
      });
      await removeFile(accountKey);
      return { file, active: legacy.meta.active !== false };
    },
    async clearAll() {
      const bridge = diskBridge();
      const database = await db();
      const keys = await requestToPromise(database.transaction(STORE, 'readonly').objectStore(STORE).getAllKeys());
      for (const key of keys) {
        const text = String(key);
        if (bridge && text.startsWith(UPLOADED_BACKGROUND_ACCOUNT_KEY_PREFIX)) await bridge({ action: 'remove', accountKey: text });
        await requestToPromise(database.transaction(STORE, 'readwrite').objectStore(STORE).delete(key));
      }
    }
  };
}

let shared: UploadedBackgroundStore | null = null;

export function getUploadedBackgroundStore(): UploadedBackgroundStore {
  shared ??= createUploadedBackgroundStore();
  return shared;
}

/** 删除所有账号上传的背景文件。 */
export async function clearAllUploadedBackgrounds(): Promise<void> {
  await getUploadedBackgroundStore().clearAll();
}
