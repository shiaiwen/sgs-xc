/**
 * 礼包码自动兑换：在「自动领取」总开关打开时，登录后拉取线上码列表并填入游戏兑换窗。
 * 尝试记录按游戏账号编号写入 localStorage，避免重复兑换。
 */

import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import { resolveGameAccountId } from '../../runtime/game-account-session.ts';
import { AUTO_TASK_ENABLED_KEY } from '../auto-task/auto-task-settings.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import { createTaskScope } from '../skin-background/skin-runtime.ts';
import { createAutoTaskWindows } from '../auto-task/auto-task-windows.ts';
import { showToast } from '../../ui/toast/show-toast.ts';

type UnknownRecord = Record<string, unknown>;

export interface GiftCodeControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  storage?: Pick<Storage, 'getItem' | 'setItem'>;
  configStore?: XiaochaoConfigStore;
  endpoint?: string;
  fetcher?: typeof fetch;
  loginDelayMs?: number;
  exchangeIntervalMs?: number;
}

const DEFAULT_ENDPOINT = 'https://95chong.cn/api/game-gift-codes';
const ATTEMPT_SUFFIX = '::XC_GAME_GIFT_CODE_ATTEMPTS';
const ACCOUNT_POLL_MS = 1_000;
const LOGIN_DELAY_MS = 3_000;
const EXCHANGE_INTERVAL_MS = 2_000;
const WINDOW_RELEASE_MS = 2_000;
const ACCOUNT_STABLE_MS = 1_000;

const INPUT_CANDIDATES = [
  'giftInput',
  'codeInput',
  'txtInput',
  'txtCode',
  'inputTxt',
  'input',
  'm_Input',
  '_input',
  'mInput'
];

const SUBMIT_CANDIDATES = [
  'getClicked',
  'onOkClick',
  'onClick',
  'onSubmit',
  'submit',
  'click',
  'onExchange',
  'exchange'
];

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/** 规范化远程返回的码列表：去空、去重、保序。 */
function normalizeCodes(value: unknown): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of Array.isArray(value) ? value : []) {
    const code = String(typeof item === 'string' ? item : asRecord(item)?.code ?? '').trim();
    if (!code || seen.has(code)) continue;
    seen.add(code);
    result.push(code);
  }
  return result;
}

function readAttempts(storage: GiftCodeControllerOptions['storage'], id: string): Set<string> {
  try {
    const parsed = JSON.parse(storage?.getItem(`${id}${ATTEMPT_SUFFIX}`) || '[]');
    return new Set((Array.isArray(parsed) ? parsed : []).map(String).filter(Boolean));
  } catch {
    return new Set();
  }
}

function writeAttempts(
  storage: GiftCodeControllerOptions['storage'],
  id: string,
  attempts: Set<string>
): void {
  try {
    storage?.setItem(`${id}${ATTEMPT_SUFFIX}`, JSON.stringify([...attempts]));
  } catch {
    // 无存储权限时仍允许本次运行继续兑换。
  }
}

/** 判断一个对象是不是可写 text 的输入框。 */
function isTextInput(value: unknown): value is UnknownRecord {
  const record = asRecord(value);
  return record != null && typeof record.text === 'string';
}

/** 在兑换窗实例上找到输入框和提交方法。 */
function findExchangeControls(exchange: UnknownRecord): { input: UnknownRecord; submit: () => void } | null {
  for (const key of INPUT_CANDIDATES) {
    const candidate = exchange[key];
    if (isTextInput(candidate)) {
      for (const submitKey of SUBMIT_CANDIDATES) {
        const submit = exchange[submitKey];
        if (typeof submit === 'function') {
          return { input: candidate, submit: submit as () => void };
        }
      }
    }
  }
  // 兜底：扫描所有属性，找第一个带 text 的对象和第一个像提交的方法。
  let fallbackInput: UnknownRecord | null = null;
  let fallbackSubmit: (() => void) | null = null;
  for (const key of Object.keys(exchange)) {
    const value = exchange[key];
    if (!fallbackInput && isTextInput(value)) fallbackInput = value;
    if (!fallbackSubmit && typeof value === 'function' && /(?:click|submit|exchange|ok)/i.test(key)) {
      fallbackSubmit = value as () => void;
    }
  }
  if (fallbackInput && fallbackSubmit) {
    return { input: fallbackInput, submit: fallbackSubmit };
  }
  return null;
}

/** 安装礼包码控制器；返回 dispose（清定时器与窗口引用）。 */
export function installGiftCodeController(options: GiftCodeControllerOptions = {}): () => void {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const storage = options.storage ?? globalObject.localStorage;
  const fetcher = options.fetcher ?? globalThis.fetch?.bind(globalThis);
  const endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
  const loginDelayMs = options.loginDelayMs ?? LOGIN_DELAY_MS;
  const exchangeIntervalMs = options.exchangeIntervalMs ?? EXCHANGE_INTERVAL_MS;
  const configStore = options.configStore;
  const tasks = createTaskScope('礼包码');
  const windows = createAutoTaskWindows(globalObject, locator, tasks);
  const seenAt = new Map<string, number>();
  const finished = new Set<string>();
  const startedAt = Date.now();
  let stopPolling: (() => void) | null = null;
  let stopConfig: (() => void) | null = null;
  let runningId = '';
  let missingAccountLogged = false;

  const autoTaskEnabled = () => configStore?.get(AUTO_TASK_ENABLED_KEY) === true;

  // 每次都重新读。换号登录后要立刻换成新账号的兑换记录。
  function currentAccountId(): string {
    return resolveGameAccountId(globalObject, locator);
  }

  /** GET 远程礼包码接口，校验 ok 字段后返回码数组。 */
  async function fetchCodes(): Promise<string[]> {
    if (!fetcher) return [];
    const response = await fetcher(endpoint, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw new Error(`礼包码服务返回 ${response.status}`);
    const payload = asRecord(await response.json());
    if (!payload?.ok) throw new Error(String(payload?.error || payload?.message || '礼包码服务异常'));
    return normalizeCodes(payload.codes);
  }

  /**
   * 兑换当前账号尚未记录的码。
   * 返回 done 表示列表已全部尝试过；retry 表示窗口或网络还没好，下次轮询再试。
   */
  async function redeemAccount(id: string): Promise<'done' | 'retry'> {
    if (!autoTaskEnabled() || !id || currentAccountId() !== id || tasks.disposed) return 'retry';
    let codes: string[];
    try {
      codes = await fetchCodes();
    } catch (error) {
      console.warn('[礼包码] 拉取失败:', error);
      return 'retry';
    }
    const attempts = readAttempts(storage, id);
    const pending = codes.filter((code) => !attempts.has(code));
    if (!pending.length) {
      return 'done';
    }
    const notice = `发现 ${pending.length} 个新礼包码，开始自动兑换`;
    showToast(notice);
    for (const code of pending) {
      if (!autoTaskEnabled() || tasks.disposed || currentAccountId() !== id) return 'retry';
      const exchange = windows.get('GiftExchangeWindow');
      const controls = exchange ? findExchangeControls(exchange) : null;
      if (!exchange || !controls) {
        const keys = exchange ? Object.keys(exchange).filter((k) => {
          const v = exchange[k];
          return typeof v === 'function' || isTextInput(v);
        }).slice(0, 30) : [];
        console.warn('[礼包码] 游戏兑换窗口尚未就绪，稍后重试；可用属性:', keys);
        return 'retry';
      }
      try {
        // 部分窗口需要挂到舞台/弹出才能触发网络请求。
        if (typeof exchange.popup === 'function') exchange.popup.call(exchange);
        else if (typeof exchange.show === 'function') exchange.show.call(exchange);
        controls.input.text = code;
        controls.submit.call(exchange);
        attempts.add(code);
        writeAttempts(storage, id, attempts);
      } catch (error) {
        console.warn('[礼包码] 兑换失败:', code, error);
      } finally {
        windows.release('GiftExchangeWindow', WINDOW_RELEASE_MS);
      }
      if (code !== pending[pending.length - 1]) {
        await new Promise<void>((resolve) => tasks.later(resolve, exchangeIntervalMs));
      }
    }
    return 'done';
  }

  /** 登录满延迟再兑换；窗口未就绪不记完成，下一轮继续。 */
  function scheduleCurrentAccount(): void {
    if (!autoTaskEnabled() || runningId || tasks.disposed) return;
    const id = currentAccountId();
    if (!id) {
      if (!missingAccountLogged && Date.now() - startedAt > 8_000) {
        missingAccountLogged = true;
        console.warn('[礼包码] 还没读到账号编号，兑换未开始');
      }
      return;
    }
    if (finished.has(id)) return;
    const now = Date.now();
    const firstSeen = seenAt.get(id);
    if (firstSeen == null) {
      seenAt.set(id, now);
      return;
    }
    // 账号切走后重登要重新等待。
    if (now - firstSeen < Math.max(loginDelayMs, ACCOUNT_STABLE_MS)) return;
    if (id === '0' || !id) return;
    runningId = id;
    void redeemAccount(id).then((result) => {
      if (result === 'done') finished.add(id);
    }).finally(() => {
      if (runningId === id) runningId = '';
    });
  }

  scheduleCurrentAccount();
  stopPolling = everyInterval(tasks.label, ACCOUNT_POLL_MS * 2, scheduleCurrentAccount);
  if (configStore) {
    stopConfig = configStore.subscribe(AUTO_TASK_ENABLED_KEY, () => {
      if (autoTaskEnabled()) scheduleCurrentAccount();
    });
  }

  return () => {
    stopPolling?.();
    stopPolling = null;
    stopConfig?.();
    stopConfig = null;
    windows.dispose();
    tasks.dispose();
  };
}
