/**
 * 自定义背景图存在本机，同一时间只保留一张。
 */

const DB_NAME = 'xiaochao-custom-background';
const STORE = 'background';
const KEY = 'current';
const DB_VERSION = 1;
export const CUSTOM_BACKGROUND_MAX_BYTES = 3 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export interface CustomBackgroundRecord {
  blob: Blob;
  active: boolean;
  updatedAt: number;
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

export function assertCustomBackgroundFile(file: Blob): void {
  if (!ALLOWED_TYPES.has(file.type)) throw new Error('只支持 png、jpg、webp');
  if (file.size <= 0 || file.size > CUSTOM_BACKGROUND_MAX_BYTES) throw new Error('图片需小于 3MB');
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

export function createCustomBackgroundStore(): CustomBackgroundStore {
  const listeners = new Set<() => void>();
  let database: Promise<IDBDatabase> | null = null;

  function db(): Promise<IDBDatabase> {
    database ??= openDb();
    return database;
  }

  function notify(): void {
    listeners.forEach((listener) => listener());
  }

  async function load(): Promise<CustomBackgroundRecord | null> {
    const store = (await db()).transaction(STORE, 'readonly').objectStore(STORE);
    const row = await requestToPromise(store.get(KEY));
    if (!row || typeof row !== 'object' || !(row.blob instanceof Blob)) return null;
    return { blob: row.blob, active: row.active !== false, updatedAt: Number(row.updatedAt) || 0 };
  }

  return {
    load,
    async save(file) {
      assertCustomBackgroundFile(file);
      const record: CustomBackgroundRecord = { blob: file, active: true, updatedAt: Date.now() };
      const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
      await requestToPromise(store.put(record, KEY));
      notify();
      return record;
    },
    async setActive(active) {
      const current = await load();
      if (!current) return;
      const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
      await requestToPromise(store.put({ ...current, active }, KEY));
      notify();
    },
    async clear() {
      const store = (await db()).transaction(STORE, 'readwrite').objectStore(STORE);
      await requestToPromise(store.delete(KEY));
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
