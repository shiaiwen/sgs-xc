import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { createLayaObjectLocator } from '../../adapters/laya-object-locator.ts';
import {
  ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_PATTERN,
  ANNIVERSARY_ASSIST_REFRESH_EVENT,
  ANNIVERSARY_ASSIST_WINDOW_END_MS,
} from '../../const/anniversary-assist.ts';
import { CONFIG_ACCOUNT_SYNC_EVENT, type XiaochaoConfigStore } from '../../config/config-store.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  claimAnniversaryAssistJob,
  fetchAnniversaryAssistStatus,
  leaveAnniversaryAssist,
  rejectAnniversaryAssistJob,
  syncAnniversaryAssist,
} from './anniversary-assist-api.ts';
import { resolveAnniversaryLedgerScope } from './anniversary-assist-scope.ts';
import {
  ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY,
  ANNIVERSARY_ASSIST_ENABLED_KEY,
  isAnniversaryAssistEnabledValue,
} from './anniversary-assist-settings.ts';
import type {
  AnniversaryAssistBindAttempt,
  AnniversaryAssistReceipt,
  AnniversaryAssistUiStatus,
} from './anniversary-assist-types.ts';
import {
  ensureDailyBindReadyReport,
  findDailyBindManager,
  isAnniversaryAssistActivityOpen,
  isModeSceneHall,
  requestDailyBind,
} from './daily-bind-game-bridge.ts';
import { verifyAnniversaryAssistItems } from './daily-bind-list-verify.ts';

export interface AnniversaryAssistController {
  refresh(): void;
  setEnabled(next: boolean): Promise<void>;
  saveCreditAccount(text: string): Promise<{ ok: boolean; message: string }>;
  getStatus(): AnniversaryAssistUiStatus;
  subscribe(listener: (status: AnniversaryAssistUiStatus) => void): () => void;
  dispose(): void;
}

const DEFAULT_UI: AnniversaryAssistUiStatus = {
  phase: 'idle',
  message: '默认关闭',
  totals: { given: 0, received: 0, pending: 0 },
  selfTransferred: 0,
  creditAccountId: '',
  transferredContributions: [],
  todayUsed: '0/3',
  activityOpen: false,
  enabled: false,
};

const MAX_SYNC_PASSES = 4;

export function installAnniversaryAssistController(
  configStore: XiaochaoConfigStore,
  gameEvents: GameEventBus,
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): AnniversaryAssistController {
  const locator = createLayaObjectLocator(globalObject);
  const listeners = new Set<(status: AnniversaryAssistUiStatus) => void>();
  let ui: AnniversaryAssistUiStatus = {
    ...DEFAULT_UI,
    enabled: isAnniversaryAssistEnabledValue(configStore.get(ANNIVERSARY_ASSIST_ENABLED_KEY)),
    creditAccountId: String(configStore.get(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY) || ''),
  };
  let disposed = false;
  let running = false;
  let rerun = false;
  let sessionToken = 0;
  let creditVersion = 0;
  let activityTimer: number | undefined;
  const pendingReceipts: AnniversaryAssistReceipt[] = [];
  const pendingBindAttempts: AnniversaryAssistBindAttempt[] = [];

  const publish = () => listeners.forEach((listener) => listener(ui));

  const setUi = (patch: Partial<AnniversaryAssistUiStatus>) => {
    ui = { ...ui, ...patch };
    publish();
  };

  const guardSession = (token: number): boolean => {
    if (token !== sessionToken || disposed) return false;
    if (!isAnniversaryAssistEnabledValue(configStore.get(ANNIVERSARY_ASSIST_ENABLED_KEY))) return false;
    if (!isModeSceneHall(locator)) return false;
    if (!resolveAnniversaryLedgerScope(globalObject)) return false;
    const manager = findDailyBindManager(locator);
    if (!isAnniversaryAssistActivityOpen(manager)) return false;
    return true;
  };

  const applyRemoteCredit = (creditAccountId: string | undefined, nextVersion: number | undefined) => {
    const remoteId = String(creditAccountId ?? '');
    const localId = String(configStore.get(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY) || '').trim();
    const version = typeof nextVersion === 'number' ? nextVersion : 0;
    if (version > creditVersion) {
      creditVersion = version;
      configStore.set(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY, remoteId);
      return;
    }
    if (!localId && remoteId) {
      creditVersion = Math.max(creditVersion, version);
      configStore.set(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY, remoteId);
    }
  };

  const refreshRemoteStatus = async (scope: NonNullable<ReturnType<typeof resolveAnniversaryLedgerScope>>, token: number) => {
    const status = await fetchAnniversaryAssistStatus(scope);
    if (!guardSession(token)) return;
    if (!status.ok) return;
    if (status.totals) setUi({ totals: status.totals });
    applyRemoteCredit(status.creditAccountId, status.creditVersion);
    setUi({
      selfTransferred: status.selfTransferred ?? ui.selfTransferred,
      creditAccountId: String(configStore.get(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY) || ''),
      transferredContributions: status.transferredContributions ?? ui.transferredContributions,
    });
  };

  const bootstrapCreditAccount = async (
    scope: NonNullable<ReturnType<typeof resolveAnniversaryLedgerScope>>,
    token: number
  ) => {
    const localCredit = String(configStore.get(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY) || '').trim();
    if (!localCredit) return;
    const { setAnniversaryCreditAccount } = await import('./anniversary-assist-api.ts');
    const result = await setAnniversaryCreditAccount(scope, localCredit, { onlyIfUnset: true });
    if (!guardSession(token)) return;
    if (!result.ok) return;
    if (typeof result.creditVersion === 'number') creditVersion = result.creditVersion;
    applyRemoteCredit(result.creditAccountId, result.creditVersion);
  };

  const scheduleActivityEnd = () => {
    if (activityTimer !== undefined) globalObject.clearTimeout(activityTimer);
    const remain = ANNIVERSARY_ASSIST_WINDOW_END_MS - Date.now();
    if (remain <= 0) return;
    activityTimer = globalObject.setTimeout(() => {
      activityTimer = undefined;
      ++sessionToken;
      setUi({ activityOpen: false, phase: 'idle', message: '活动已结束' });
    }, remain);
  };

  async function runOnce(): Promise<void> {
    if (disposed || running) {
      rerun = true;
      return;
    }
    const token = ++sessionToken;
    if (!isAnniversaryAssistEnabledValue(configStore.get(ANNIVERSARY_ASSIST_ENABLED_KEY))) {
      setUi({ phase: 'idle', message: '未开启互助' });
      return;
    }
    if (!isModeSceneHall(locator)) {
      setUi({ phase: 'idle', message: '仅在大厅执行，对局中已暂停' });
      return;
    }
    const scope = resolveAnniversaryLedgerScope(globalObject);
    if (!scope) {
      setUi({ phase: 'idle', message: '未登录或登录账号未就绪' });
      return;
    }
    const manager = findDailyBindManager(locator);
    if (!isAnniversaryAssistActivityOpen(manager)) {
      setUi({ phase: 'idle', message: '活动未开放', activityOpen: false });
      return;
    }
    scheduleActivityEnd();
    setUi({ activityOpen: true, phase: 'syncing', message: '同步中…' });
    running = true;
    try {
      await refreshRemoteStatus(scope, token);
      await bootstrapCreditAccount(scope, token);
      const ready = await ensureDailyBindReadyReport(manager, globalObject);
      if (!guardSession(token)) return;
      if (!ready) {
        setUi({ phase: 'error', message: '读取互助进度失败' });
        return;
      }
      setUi({ todayUsed: `${ready.used}/3` });

      const creditAccountId = String(configStore.get(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY) || '').trim();
      let lastJob: { id: string; partnerUserId?: string; validUntil?: number } | null = null;

      for (let pass = 0; pass < MAX_SYNC_PASSES; pass += 1) {
        if (!guardSession(token)) return;
        const sync = await syncAnniversaryAssist(scope, {
          ready,
          receipts: pendingReceipts.splice(0),
          bindAttempts: pendingBindAttempts.splice(0),
          creditAccountId: creditAccountId.length > 0 ? creditAccountId : undefined,
          creditVersion: creditVersion > 0 ? creditVersion : undefined,
          claimBeforeBind: true,
        });
        if (!guardSession(token)) return;
        if (!sync.ok) {
          setUi({ phase: 'error', message: sync.error ?? '同步失败' });
          return;
        }
        if (typeof sync.creditVersion === 'number' && sync.creditVersion > 0) {
          creditVersion = sync.creditVersion;
        }
        applyRemoteCredit(sync.creditAccountId, sync.creditVersion);
        if (sync.totals) {
          setUi({
            totals: sync.totals,
            selfTransferred: sync.selfTransferred ?? ui.selfTransferred,
            creditAccountId: String(configStore.get(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY) || ''),
            transferredContributions: sync.transferredContributions ?? [],
          });
        }

        if (sync.verify?.length) {
          setUi({ phase: 'verifying', message: '列表核验中…' });
          const resolved = await verifyAnniversaryAssistItems(
            manager,
            sync.verify,
            () => guardSession(token),
            globalObject
          );
          if (!guardSession(token)) return;
          if (resolved.length > 0) {
            pendingReceipts.push(...resolved);
            rerun = true;
            continue;
          }
          setUi({ phase: 'idle', message: '核验未完成，可稍后手动刷新' });
          return;
        }

        const job = sync.job;
        if (!job?.id) {
          if (!ready.canBind) {
            setUi({
              phase: 'idle',
              message: ready.used >= 3 ? '今日帮绑次数已满' : '管理器忙碌或未就绪',
            });
          } else {
            setUi({ phase: 'idle', message: '暂无互助任务' });
          }
          return;
        }
        lastJob = {
          id: job.id,
          partnerUserId: job.partnerUserId,
          validUntil: job.expiresAt,
        };
        break;
      }

      if (!lastJob) {
        setUi({ phase: 'idle', message: '同步未完成' });
        return;
      }
      if (!ready.canBind) {
        setUi({
          phase: 'idle',
          message: ready.used >= 3 ? '今日帮绑次数已满' : '管理器忙碌或未就绪',
        });
        return;
      }

      setUi({ phase: 'binding', message: '领取任务…' });
      const claim = await claimAnniversaryAssistJob(scope, lastJob.id);
      if (!guardSession(token)) return;
      const code = claim.code;
      if (!claim.ok || !code) {
        setUi({ phase: 'error', message: claim.error ?? '领取任务失败' });
        return;
      }
      if (lastJob.validUntil && Date.now() >= lastJob.validUntil) {
        setUi({ phase: 'error', message: '任务已过期' });
        return;
      }

      const bindResult = await requestDailyBind(manager, globalObject, code);
      if (!guardSession(token)) return;
      if (bindResult !== null && bindResult !== -1 && bindResult !== 0) {
        await rejectAnniversaryAssistJob(scope, lastJob.id, bindResult);
        setUi({ phase: 'error', message: '绑定被拒绝' });
        return;
      }
      pendingBindAttempts.push({
        jobId: lastJob.id,
        partnerUserId: String(lastJob.partnerUserId || ''),
        attemptedAt: Date.now(),
        result: bindResult,
      });
      rerun = true;
      setUi({ phase: 'verifying', message: '已提交绑定，等待列表核验' });
    } catch (error) {
      setUi({ phase: 'error', message: error instanceof Error ? error.message : '执行失败' });
    } finally {
      running = false;
      if (rerun) {
        rerun = false;
        void runOnce();
      }
    }
  }

  const unsubscribes: Array<() => void> = [
    configStore.subscribe(ANNIVERSARY_ASSIST_ENABLED_KEY, () => {
      ++sessionToken;
      setUi({ enabled: isAnniversaryAssistEnabledValue(configStore.get(ANNIVERSARY_ASSIST_ENABLED_KEY)) });
      if (isAnniversaryAssistEnabledValue(configStore.get(ANNIVERSARY_ASSIST_ENABLED_KEY))) void runOnce();
    }),
    configStore.subscribe(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY, () => {
      ++sessionToken;
      setUi({ creditAccountId: String(configStore.get(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY) || '') });
    }),
    gameEvents.subscribe((event) => {
      if (event.type === 'game-ended') void runOnce();
      if (event.type === 'game-started') {
        ++sessionToken;
        setUi({ message: '对局中已暂停互助' });
      }
    }),
  ];

  const onRefresh = () => void runOnce();
  globalObject.addEventListener(ANNIVERSARY_ASSIST_REFRESH_EVENT, onRefresh);
  const onAccountSwitch = () => {
    ++sessionToken;
    creditVersion = 0;
    pendingReceipts.length = 0;
    pendingBindAttempts.length = 0;
    setUi({
      ...DEFAULT_UI,
      enabled: isAnniversaryAssistEnabledValue(configStore.get(ANNIVERSARY_ASSIST_ENABLED_KEY)),
      creditAccountId: String(configStore.get(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY) || ''),
    });
  };
  globalObject.addEventListener(CONFIG_ACCOUNT_SYNC_EVENT, onAccountSwitch);

  return {
    refresh: onRefresh,
    async setEnabled(next) {
      if (next) {
        configStore.set(ANNIVERSARY_ASSIST_ENABLED_KEY, true);
        setUi({ enabled: true });
        void runOnce();
        return;
      }
      ++sessionToken;
      configStore.set(ANNIVERSARY_ASSIST_ENABLED_KEY, 'leaving');
      setUi({ phase: 'syncing', message: '正在退出互助…', enabled: false });
      const scope = resolveAnniversaryLedgerScope(globalObject);
      if (scope) await leaveAnniversaryAssist(scope);
      configStore.set(ANNIVERSARY_ASSIST_ENABLED_KEY, false);
      pendingReceipts.length = 0;
      pendingBindAttempts.length = 0;
      setUi({ phase: 'idle', message: '已关闭', enabled: false });
    },
    async saveCreditAccount(text) {
      const scope = resolveAnniversaryLedgerScope(globalObject);
      if (!scope) return { ok: false, message: '未登录' };
      const trimmed = text.trim();
      if (trimmed && !ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_PATTERN.test(trimmed)) {
        return { ok: false, message: '大号编号格式不对' };
      }
      if (trimmed && trimmed === scope.gameUserId) return { ok: false, message: '不能填自己的编号' };
      ++sessionToken;
      const { setAnniversaryCreditAccount } = await import('./anniversary-assist-api.ts');
      const result = await setAnniversaryCreditAccount(scope, trimmed);
      if (!result.ok) return { ok: false, message: result.error ?? '保存失败' };
      configStore.set(ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY, result.creditAccountId ?? trimmed);
      if (typeof result.creditVersion === 'number') creditVersion = result.creditVersion;
      setUi({ creditAccountId: String(result.creditAccountId ?? '') });
      void runOnce();
      return { ok: true, message: trimmed ? '已保存' : '已清空大号' };
    },
    getStatus: () => ui,
    subscribe(listener) {
      listeners.add(listener);
      listener(ui);
      return () => listeners.delete(listener);
    },
    dispose() {
      disposed = true;
      ++sessionToken;
      if (activityTimer !== undefined) globalObject.clearTimeout(activityTimer);
      unsubscribes.forEach((stop) => stop());
      globalObject.removeEventListener(ANNIVERSARY_ASSIST_REFRESH_EVENT, onRefresh);
      globalObject.removeEventListener(CONFIG_ACCOUNT_SYNC_EVENT, onAccountSwitch);
      listeners.clear();
    },
  };
}