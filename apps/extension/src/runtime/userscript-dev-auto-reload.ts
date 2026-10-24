/**
 * 本地油猴开发：本机 build 版本变化时刷新游戏页。
 * 标签在后台时只记新版本不刷新，避免切回游戏时卡在加载界面。
 */
export function installUserscriptDevAutoReload(pollUrl: string): void {
  const url = String(pollUrl ?? '').trim();
  if (!url || typeof window === 'undefined') return;
  if (window.localStorage?.getItem('xcDevAutoReload') === '0') return;

  let seen = '';
  const loadedAt = Date.now();
  /** 进游戏后一段时间内不因 dev build 刷新，避免加载条停在 100%。 */
  const warmupMs = 90_000;
  const reloadCooldownMs = 20_000;
  let lastReloadAt = 0;

  const poll = () => {
    void fetch(url, { cache: 'no-store', mode: 'cors' })
      .then((response) => (response.ok ? response.text() : ''))
      .then((token) => {
        const next = String(token ?? '').trim();
        if (!next) return;
        if (!seen) {
          seen = next;
          return;
        }
        if (next === seen) return;
        if (document.hidden) {
          seen = next;
          return;
        }
        if (Date.now() - loadedAt < warmupMs) {
          seen = next;
          return;
        }
        if (Date.now() - lastReloadAt < reloadCooldownMs) {
          seen = next;
          return;
        }
        seen = next;
        lastReloadAt = Date.now();
        window.location.reload();
      })
      .catch(() => {
        // 本机 dev 未启动时忽略。
      });
  };

  poll();
  window.setInterval(poll, 1500);
}
