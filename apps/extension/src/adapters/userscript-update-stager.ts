/**
 * 浏览器油猴：后台下载新版小抄，核对校验值和版本号后存进本地数据库，
 * 刷新页面后由脚本开头的启动代码运行。
 * 只有脚本是由那段启动代码带起来的才工作；开发版和缺少浏览器接口时一律报不支持。
 */
import { HEX_DIGITS_PER_BYTE, HEX_RADIX } from '../const/text-hash.ts';
import {
  USERSCRIPT_PAYLOAD_BLOCKED_KEY,
  USERSCRIPT_PAYLOAD_DB_NAME,
  USERSCRIPT_PAYLOAD_DB_VERSION,
  USERSCRIPT_PAYLOAD_LOADER_GLOBAL,
  USERSCRIPT_PAYLOAD_MARKER,
  USERSCRIPT_PAYLOAD_MAX_BYTES,
  USERSCRIPT_PAYLOAD_RECORD_KEY,
  USERSCRIPT_PAYLOAD_RETRY_MS,
  USERSCRIPT_PAYLOAD_STORE_NAME,
  USERSCRIPT_PAYLOAD_URL,
  USERSCRIPT_PAYLOAD_VERSION_KEY
} from '../const/userscript-payload.ts';
import type { StagedUpdateReport, UpdatePackageRequest } from './platform';

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/;

const UNSUPPORTED_UPDATE: StagedUpdateReport = {
  supported: false,
  stagedVersion: '',
  failed: false,
  manualRequired: false
};

interface PayloadRecord {
  version: string;
  sha256: string;
  code: string;
}

/**
 * 返回油猴平台的 stageUpdate：同一版本同时只下一份，失败后隔一段时间才重试。
 * 下载失败只算还在准备，例如版本服务刚上传完清单、新版代码还没传完；一直准备不好由无感更新的等待上限改成提示手动更新。
 */
export function createUserscriptUpdateStager(
  globalObject: Window = window
): (request: UpdatePackageRequest) => Promise<StagedUpdateReport> {
  let downloadingVersion = '';
  let failedVersion = '';
  let failedAt = 0;

  let canRunDownloadedCode: boolean | null = null;

  return async function stageUpdate(request) {
    if (!isStartedByPayloadLoader(globalObject) || !canStagePayload(globalObject) || !isPinnedPayload(request)) {
      return UNSUPPORTED_UPDATE;
    }
    canRunDownloadedCode ??= probeDownloadedCodeAllowed(globalObject);
    if (!canRunDownloadedCode) return UNSUPPORTED_UPDATE;
    const stagedVersion = readPageStorage(globalObject, USERSCRIPT_PAYLOAD_VERSION_KEY);
    const report = (failed: boolean): StagedUpdateReport => ({
      supported: true,
      stagedVersion,
      failed,
      manualRequired: false
    });
    // 刷新后启动代码跑不起这一版，例如网站禁止运行下载的代码，下多少次都没用。
    if (readPageStorage(globalObject, USERSCRIPT_PAYLOAD_BLOCKED_KEY) === request.version) return report(true);
    if (stagedVersion === request.version || downloadingVersion === request.version) return report(false);
    if (failedVersion === request.version && Date.now() - failedAt < USERSCRIPT_PAYLOAD_RETRY_MS) return report(false);
    downloadingVersion = request.version;
    void downloadPayload(globalObject, request).then(() => {
      failedVersion = '';
    }, (error: unknown) => {
      failedVersion = request.version;
      failedAt = Date.now();
      console.warn('[xiaochao] 后台下载新版失败', error);
    }).finally(() => {
      if (downloadingVersion === request.version) downloadingVersion = '';
    });
    return report(false);
  };
}

function isStartedByPayloadLoader(globalObject: Window): boolean {
  const loader = (globalObject as unknown as Record<string, unknown>)[USERSCRIPT_PAYLOAD_LOADER_GLOBAL];
  return loader !== null && typeof loader === 'object'
    && typeof (loader as Record<string, unknown>).embeddedVersion === 'string';
}

function canStagePayload(globalObject: Window): boolean {
  return typeof globalObject.fetch === 'function'
    && typeof globalObject.indexedDB?.open === 'function'
    && typeof globalObject.crypto?.subtle?.digest === 'function'
    && typeof TextDecoder === 'function';
}

/** 启动代码用 Function 运行下载的代码；网站安全策略禁止时下载了也跑不起来，就别下。 */
function probeDownloadedCodeAllowed(globalObject: Window): boolean {
  try {
    const FunctionConstructor = (globalObject as unknown as { Function: FunctionConstructor }).Function;
    return new FunctionConstructor('return true')() === true;
  } catch {
    return false;
  }
}

function isPinnedPayload(request: UpdatePackageRequest): boolean {
  return request.userscriptPayloadUrl.split('?')[0] === USERSCRIPT_PAYLOAD_URL
    && SHA256_HEX_PATTERN.test(request.userscriptPayloadSha256);
}

function readPageStorage(globalObject: Window, key: string): string {
  try {
    return String(globalObject.localStorage.getItem(key) ?? '');
  } catch {
    return '';
  }
}

async function downloadPayload(globalObject: Window, request: UpdatePackageRequest): Promise<void> {
  const url = new URL(request.userscriptPayloadUrl);
  url.searchParams.set('v', request.version);
  const response = await globalObject.fetch(url.toString(), {
    method: 'GET',
    mode: 'cors',
    credentials: 'omit',
    cache: 'no-store',
    referrerPolicy: 'no-referrer'
  });
  if (!response.ok) throw new Error(`下载返回 ${response.status}`);
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > USERSCRIPT_PAYLOAD_MAX_BYTES) throw new Error('新版代码超过大小上限');
  const sha256 = toHex(await globalObject.crypto.subtle.digest('SHA-256', bytes));
  if (sha256 !== request.userscriptPayloadSha256) throw new Error('新版代码校验值不符');
  const code = new TextDecoder().decode(bytes);
  if (!code.startsWith(`${USERSCRIPT_PAYLOAD_MARKER}${request.version}\n`)) throw new Error('新版代码版本号不符');
  await writePayloadRecord(globalObject.indexedDB, { version: request.version, sha256, code });
  // 代码先进数据库再写版本号：启动代码只认这个版本号，顺序反了会去取一份还没写完的代码。
  globalObject.localStorage.setItem(USERSCRIPT_PAYLOAD_VERSION_KEY, request.version);
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (byte) => byte.toString(HEX_RADIX).padStart(HEX_DIGITS_PER_BYTE, '0')).join('');
}

function writePayloadRecord(database: IDBFactory, record: PayloadRecord): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = database.open(USERSCRIPT_PAYLOAD_DB_NAME, USERSCRIPT_PAYLOAD_DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(USERSCRIPT_PAYLOAD_STORE_NAME)) {
        request.result.createObjectStore(USERSCRIPT_PAYLOAD_STORE_NAME);
      }
    };
    request.onerror = () => reject(request.error ?? new Error('打不开本地数据库'));
    request.onblocked = () => reject(new Error('本地数据库被别的页面占着'));
    request.onsuccess = () => {
      const connection = request.result;
      try {
        const transaction = connection.transaction(USERSCRIPT_PAYLOAD_STORE_NAME, 'readwrite');
        transaction.objectStore(USERSCRIPT_PAYLOAD_STORE_NAME).put(record, USERSCRIPT_PAYLOAD_RECORD_KEY);
        transaction.oncomplete = () => {
          connection.close();
          resolve();
        };
        transaction.onerror = () => {
          connection.close();
          reject(transaction.error ?? new Error('新版代码写入本地数据库失败'));
        };
        transaction.onabort = () => {
          connection.close();
          reject(transaction.error ?? new Error('新版代码写入本地数据库被中断'));
        };
      } catch (error) {
        connection.close();
        reject(error);
      }
    };
  });
}
