/**
 * 浏览器油猴脚本的启动代码，以及打包时拼装两份产物的函数。
 * 装进油猴的那份：油猴头 + 启动代码 + 脚本自带的小抄。
 * 给后台下载的那份：第一行写版本号，后面只有小抄本体。
 * 启动代码看本地有没有下好的、比自带更新的版本，有就运行它，没有或出错就运行自带的，任何时候只跑一份。
 */
import {
  USERSCRIPT_PAYLOAD_BLOCKED_KEY,
  USERSCRIPT_PAYLOAD_DB_NAME,
  USERSCRIPT_PAYLOAD_DB_VERSION,
  USERSCRIPT_PAYLOAD_LOADER_GLOBAL,
  USERSCRIPT_PAYLOAD_MARKER,
  USERSCRIPT_PAYLOAD_READ_TIMEOUT_MS,
  USERSCRIPT_PAYLOAD_RECORD_KEY,
  USERSCRIPT_PAYLOAD_STORE_NAME,
  USERSCRIPT_PAYLOAD_VERSION_KEY,
  USERSCRIPT_STARTUP_GLOBAL
} from '../src/const/userscript-payload.ts';

export interface UserscriptPayloadSettings {
  dbName: string;
  dbVersion: number;
  storeName: string;
  recordKey: string;
  versionKey: string;
  blockedKey: string;
  loaderGlobal: string;
  startupGlobal: string;
  readTimeoutMs: number;
  marker: string;
}

const PAYLOAD_SETTINGS: UserscriptPayloadSettings = {
  dbName: USERSCRIPT_PAYLOAD_DB_NAME,
  dbVersion: USERSCRIPT_PAYLOAD_DB_VERSION,
  storeName: USERSCRIPT_PAYLOAD_STORE_NAME,
  recordKey: USERSCRIPT_PAYLOAD_RECORD_KEY,
  versionKey: USERSCRIPT_PAYLOAD_VERSION_KEY,
  blockedKey: USERSCRIPT_PAYLOAD_BLOCKED_KEY,
  loaderGlobal: USERSCRIPT_PAYLOAD_LOADER_GLOBAL,
  startupGlobal: USERSCRIPT_STARTUP_GLOBAL,
  readTimeoutMs: USERSCRIPT_PAYLOAD_READ_TIMEOUT_MS,
  marker: USERSCRIPT_PAYLOAD_MARKER
};

const USERSCRIPT_HEADER_END = '==/UserScript==';

/**
 * 启动代码。这个函数会被原样写进油猴脚本，不能引用外面的变量。
 * 本地数据库读不出来、超时、代码对不上版本，都运行脚本自带的。
 */
export function runUserscriptPayload(
  embeddedVersion: string,
  runEmbedded: () => void,
  settings: UserscriptPayloadSettings
): void {
  const root = globalThis as unknown as Record<string, unknown>;
  const loader: Record<string, unknown> = { embeddedVersion, state: 'reading', runningVersion: '', reason: '' };
  root[settings.loaderGlobal] = loader;
  let settled = false;
  const readStorage = (key: string): string => {
    try {
      return String(localStorage.getItem(key) ?? '');
    } catch {
      return '';
    }
  };
  const compareVersions = (left: string, right: string): number => {
    const leftParts = left.split('.').map((part) => Number(part) || 0);
    const rightParts = right.split('.').map((part) => Number(part) || 0);
    for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
      const difference = (leftParts[index] || 0) - (rightParts[index] || 0);
      if (difference !== 0) return difference;
    }
    return 0;
  };
  const startEmbedded = (reason: string): void => {
    if (settled) return;
    settled = true;
    loader.state = 'embedded';
    loader.reason = reason;
    loader.runningVersion = embeddedVersion;
    runEmbedded();
  };

  const stagedVersion = readStorage(settings.versionKey);
  if (!stagedVersion || compareVersions(stagedVersion, embeddedVersion) <= 0) {
    startEmbedded('no-newer-payload');
    return;
  }
  if (readStorage(settings.blockedKey) === stagedVersion) {
    startEmbedded('payload-blocked');
    return;
  }

  const timer = setTimeout(() => startEmbedded('read-timeout'), settings.readTimeoutMs);
  const startPayload = (record: unknown): void => {
    clearTimeout(timer);
    if (settled) return;
    const payload = record as { version?: unknown; code?: unknown } | null | undefined;
    const code = typeof payload?.code === 'string' ? payload.code : '';
    if (payload?.version !== stagedVersion || !code.startsWith(`${settings.marker}${stagedVersion}\n`)) {
      startEmbedded('payload-missing');
      return;
    }
    settled = true;
    loader.state = 'payload';
    loader.runningVersion = stagedVersion;
    try {
      new Function(code)();
    } catch (error) {
      console.error('[xiaochao] 下载的新版启动失败，改用脚本自带的版本', error);
      try {
        localStorage.setItem(settings.blockedKey, stagedVersion);
      } catch {
        // 记不下来时下次还会先试这一版，失败了照样退回自带的。
      }
      // 新版已经开始启动时不能再跑一份自带的，两份会抢同一个页面。
      if (root[settings.startupGlobal]) {
        loader.state = 'payload-failed';
        return;
      }
      settled = false;
      startEmbedded('payload-failed');
    }
  };

  try {
    const request = indexedDB.open(settings.dbName, settings.dbVersion);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(settings.storeName)) {
        request.result.createObjectStore(settings.storeName);
      }
    };
    request.onerror = () => startEmbedded('db-error');
    request.onsuccess = () => {
      const connection = request.result;
      try {
        const read = connection.transaction(settings.storeName, 'readonly')
          .objectStore(settings.storeName)
          .get(settings.recordKey);
        read.onsuccess = () => {
          connection.close();
          startPayload(read.result);
        };
        read.onerror = () => {
          connection.close();
          startEmbedded('db-error');
        };
      } catch {
        connection.close();
        startEmbedded('db-error');
      }
    };
  } catch {
    startEmbedded('db-error');
  }
}

function splitUserscript(source: string): { header: string; body: string } {
  const headerEnd = source.indexOf(USERSCRIPT_HEADER_END);
  if (headerEnd < 0) throw new Error(`油猴脚本缺少 ${USERSCRIPT_HEADER_END}`);
  const headerLength = headerEnd + USERSCRIPT_HEADER_END.length;
  return { header: source.slice(0, headerLength), body: source.slice(headerLength).trim() };
}

/** 给后台下载的那份：第一行写版本号，后面是小抄本体。 */
export function buildUserscriptPayload(source: string, version: string): string {
  return `${USERSCRIPT_PAYLOAD_MARKER}${version}\n${splitUserscript(source).body}\n`;
}

/** 装进油猴的那份：小抄本体包进函数，交给启动代码决定运行它还是运行下载好的新版。 */
export function wrapUserscriptWithPayloadLoader(source: string, version: string): string {
  const { header, body } = splitUserscript(source);
  const settings = JSON.stringify(PAYLOAD_SETTINGS);
  return `${header}\n\n(${runUserscriptPayload.toString()})(${JSON.stringify(version)}, function () {\n${body}\n}, ${settings});\n`;
}
