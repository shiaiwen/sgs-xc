/**
 * 本地油猴开发：本机 build 版本变化时刷新游戏页，加载最新整包 user.js。
 */
import {
  USERSCRIPT_DEV_RELOAD_AFTER_BUILD_MS,
  USERSCRIPT_DEV_RELOAD_COOLDOWN_MS,
  USERSCRIPT_DEV_RELOAD_POLL_MS,
  USERSCRIPT_DEV_RELOAD_WARMUP_MS,
  USERSCRIPT_DEV_RELOAD_WARMUP_UNTIL_KEY
} from '../const/userscript-dev-reload.ts';
import { fetchUserscriptDevText } from './userscript-dev-fetch.ts';

function warmupActive(now: number): boolean {
  try {
    const storage = window.sessionStorage;
    let until = Number(storage.getItem(USERSCRIPT_DEV_RELOAD_WARMUP_UNTIL_KEY) || 0);
    if (!until) {
      until = now + USERSCRIPT_DEV_RELOAD_WARMUP_MS;
      storage.setItem(USERSCRIPT_DEV_RELOAD_WARMUP_UNTIL_KEY, String(until));
    }
    return now < until;
  } catch {
    return now - performance.timeOrigin < USERSCRIPT_DEV_RELOAD_WARMUP_MS;
  }
}

export function installUserscriptDevAutoReload(pollUrl: string, installUrl = ''): void {
  const url = String(pollUrl ?? '').trim();
  const tampermonkeyInstallUrl = String(installUrl ?? '').trim();
  if (!url || typeof window === 'undefined') return;
  if (window.localStorage?.getItem('xcDevAutoReload') === '0') return;

  const globalRecord = globalThis as Record<string, unknown>;
  const startup = (globalRecord.__XIAOCHAO_STARTUP__ as Record<string, unknown> | undefined) ?? {};
  globalRecord.__XIAOCHAO_STARTUP__ = startup;
  const devReload: Record<string, unknown> = {
    pollUrl: url,
    installUrl: tampermonkeyInstallUrl,
    transport: typeof (globalThis as { GM_xmlhttpRequest?: unknown }).GM_xmlhttpRequest === 'function'
      ? 'gm'
      : 'fetch',
    state: 'polling'
  };
  startup.devReload = devReload;

  let seen = '';
  let pendingReload = false;
  let lastReloadAt = 0;
  let emptyPollCount = 0;

  let reloadTimer = 0;

  const openTampermonkeyUpdatePage = (buildId: string) => {
    if (!tampermonkeyInstallUrl) return;
    const target = `${tampermonkeyInstallUrl}${tampermonkeyInstallUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(buildId)}`;
    devReload.installPromptUrl = target;
    const popup = window.open(target, 'xiaochao-dev-userscript-update');
    devReload.updatePopup = popup ? 'opened' : 'blocked';
    if (popup) {
      console.info('[xiaochao dev] 已打开油猴更新页，请确认更新；约数秒后本页将自动刷新。', target);
      return;
    }
    console.warn(
      '[xiaochao dev] 浏览器拦住了更新弹窗；终端应已打开油猴更新页，或请手动打开',
      target
    );
  };

  const reloadForDevBuild = () => {
    pendingReload = false;
    lastReloadAt = Date.now();
    devReload.state = 'reloading';
    console.info('[xiaochao dev] 正在刷新游戏页以加载更新后的油猴脚本…');
    window.location.reload();
  };

  const scheduleReloadForDevBuild = () => {
    if (reloadTimer) window.clearTimeout(reloadTimer);
    devReload.state = 'waiting-reload';
    reloadTimer = window.setTimeout(() => {
      reloadTimer = 0;
      reloadForDevBuild();
    }, USERSCRIPT_DEV_RELOAD_AFTER_BUILD_MS);
  };

  const startupAllowsReload = (): boolean => {
    const state = String(
      (globalRecord.__XIAOCHAO_STARTUP__ as Record<string, unknown> | undefined)?.state ?? ''
    );
    return state === 'ready' || state === 'waiting';
  };

  const maybeReload = (next: string) => {
    const now = Date.now();
    devReload.lastBuildId = next;
    if (!startupAllowsReload()) {
      pendingReload = true;
      seen = next;
      devReload.state = 'defer-until-ready';
      return;
    }
    if (document.hidden) {
      pendingReload = true;
      seen = next;
      devReload.state = 'pending-visible';
      return;
    }
    if (warmupActive(now)) {
      seen = next;
      devReload.state = 'warmup';
      return;
    }
    if (now - lastReloadAt < USERSCRIPT_DEV_RELOAD_COOLDOWN_MS) {
      seen = next;
      return;
    }
    seen = next;
    openTampermonkeyUpdatePage(next);
    scheduleReloadForDevBuild();
  };

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && pendingReload && startupAllowsReload()) scheduleReloadForDevBuild();
  });

  const startupTimer = window.setInterval(() => {
    if (!pendingReload || !startupAllowsReload()) return;
    scheduleReloadForDevBuild();
  }, USERSCRIPT_DEV_RELOAD_POLL_MS);
  window.addEventListener('unload', () => window.clearInterval(startupTimer), { once: true });

  const poll = () => {
    void fetchUserscriptDevText(url).then((token) => {
      const next = String(token ?? '').trim();
      if (!next) {
        emptyPollCount += 1;
        devReload.emptyPollCount = emptyPollCount;
        if (emptyPollCount === 3) {
          devReload.state = 'poll-failed';
          console.warn(
            '[xiaochao dev] 读不到本机构建号，改代码后不会自动刷新游戏页。',
            '请确认 dev:userscript 在跑；HTTPS 游戏页需先在浏览器打开并信任 https://127.0.0.1:5173 引导页。',
            url
          );
        }
        return;
      }
      emptyPollCount = 0;
      devReload.state = 'watching';
      if (!seen) {
        seen = next;
        devReload.initialBuildId = next;
        console.info('[xiaochao dev] 自动刷新已监听构建号', next);
        return;
      }
      if (next === seen) return;
      maybeReload(next);
    });
  };

  poll();
  window.setInterval(poll, USERSCRIPT_DEV_RELOAD_POLL_MS);
}
