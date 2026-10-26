/**
 * 右停靠时压缩游戏画布区域；解除停靠后恢复全宽。
 */

interface DockingSnapshot {
  padding: unknown;
  backgroundWidth: string;
  backgroundWidthPriority: string;
  layaBrowser: object | undefined;
  layaClientWidthDescriptor: PropertyDescriptor | undefined;
}

let dockingSnapshot: DockingSnapshot | undefined;
let reservedPanelWidth = 0;
let lastNotifiedPanelWidth = -1;
let lastNotifiedGameWidth = -1;
let dockLayoutRetryTimer: ReturnType<typeof setInterval> | undefined;
let dockKeepaliveTimer: ReturnType<typeof setInterval> | undefined;
let bgDivObserver: MutationObserver | undefined;
let watchedBgDiv: HTMLElement | undefined;
let dockWindowListenersInstalled = false;
/** 正在把尺寸变化告诉游戏。这段时间里不再跟着重算，否则会自己套自己。 */
let notifyingResize = false;

/** 缩小游戏视口，并让 Laya 使用扣除侧栏后的宽度重新排版。 */
export function reserveGameAreaForDockedPanel(panelWidth: number): void {
  reservedPanelWidth = Math.max(0, Math.round(panelWidth));
  const gameBackground = document.getElementById('bgDiv');

  if (!dockingSnapshot) {
    const layaBrowser = (window as any).Laya?.Browser as object | undefined;
    dockingSnapshot = {
      padding: (window as any).padding,
      backgroundWidth: gameBackground?.style.getPropertyValue('width') || '',
      backgroundWidthPriority: gameBackground?.style.getPropertyPriority('width') || '',
      layaBrowser,
      layaClientWidthDescriptor: layaBrowser
        ? Object.getOwnPropertyDescriptor(layaBrowser, 'clientWidth')
        : undefined
    };
    installLayaClientWidthOverride(layaBrowser);
    installDockWindowListeners();
  }

  applyDockedViewportLayout(true);
  watchGameBackground(gameBackground);
  scheduleDockLayoutRetry();
  startDockKeepalive();
}

/** 脱离、折叠或卸载小抄时恢复 Laya 原始视口 getter 与背景宽度。 */
export function restoreFullGameArea(): void {
  teardownDockGuards();
  if (!dockingSnapshot) return;
  const snapshot = dockingSnapshot;
  dockingSnapshot = undefined;
  reservedPanelWidth = 0;
  lastNotifiedPanelWidth = -1;
  lastNotifiedGameWidth = -1;

  if (snapshot.layaBrowser && snapshot.layaClientWidthDescriptor) {
    Object.defineProperty(
      snapshot.layaBrowser,
      'clientWidth',
      snapshot.layaClientWidthDescriptor
    );
  }
  (window as any).padding = snapshot.padding;
  const gameBackground = document.getElementById('bgDiv');
  if (snapshot.backgroundWidth) {
    gameBackground?.style.setProperty(
      'width',
      snapshot.backgroundWidth,
      snapshot.backgroundWidthPriority
    );
  } else {
    gameBackground?.style.removeProperty('width');
  }
  document.documentElement.classList.remove('xiaochao-game-viewport--docked');
  document.documentElement.style.removeProperty('--sgs-center-x');
  document.documentElement.style.removeProperty('--xc-docked-panel-width');
  document.documentElement.style.removeProperty('--xc-game-viewport-width');
  requestGameResize();
}

function applyDockedViewportLayout(forceResize = false): void {
  if (reservedPanelWidth <= 0) return;
  ensureLayaClientWidthOverride();
  (window as any).padding = reservedPanelWidth;
  const gameBackground = document.getElementById('bgDiv') ?? watchedBgDiv;
  const gameWidth = getAvailableGameWidth();
  document.documentElement.style.setProperty('--xc-docked-panel-width', `${reservedPanelWidth}px`);
  document.documentElement.style.setProperty('--xc-game-viewport-width', `${gameWidth}px`);
  if (gameBackground) {
    enforceBgDivWidth(gameBackground);
    watchGameBackground(gameBackground);
  }
  document.documentElement.style.setProperty('--sgs-center-x', `${gameWidth / 2}px`);
  document.documentElement.classList.add('xiaochao-game-viewport--docked');
  // Only notify the game when the docked viewport size actually changed.
  // Periodic force-resize was spamming GAME_ADAPTATION → HideUserOptMenu (seat menu).
  const sizeChanged =
    forceResize
    || lastNotifiedPanelWidth !== reservedPanelWidth
    || lastNotifiedGameWidth !== gameWidth;
  lastNotifiedPanelWidth = reservedPanelWidth;
  lastNotifiedGameWidth = gameWidth;
  if (sizeChanged) {
    requestGameResize();
  }
}

/** 登录/大厅阶段 bgDiv、Laya 常晚于面板；先密集补同步，再交给 keepalive。 */
function scheduleDockLayoutRetry(): void {
  stopDockLayoutRetry();
  let attempts = 0;
  dockLayoutRetryTimer = setInterval(() => {
    if (reservedPanelWidth <= 0) {
      stopDockLayoutRetry();
      return;
    }
    attempts += 1;
    // Never force-resize on retry: MutationObserver already keeps bgDiv width.
    // Forcing every 800ms was killing seat opt menu via onGameAdaptation.
    applyDockedViewportLayout(false);
    if (attempts >= 90) stopDockLayoutRetry();
  }, 400);
}

function startDockKeepalive(): void {
  if (dockKeepaliveTimer !== undefined) return;
  dockKeepaliveTimer = setInterval(() => {
    if (reservedPanelWidth <= 0) {
      stopDockKeepalive();
      return;
    }
    applyDockedViewportLayout(false);
  }, 2000);
}

function stopDockLayoutRetry(): void {
  if (dockLayoutRetryTimer !== undefined) {
    clearInterval(dockLayoutRetryTimer);
    dockLayoutRetryTimer = undefined;
  }
}

function stopDockKeepalive(): void {
  if (dockKeepaliveTimer !== undefined) {
    clearInterval(dockKeepaliveTimer);
    dockKeepaliveTimer = undefined;
  }
}

function teardownDockGuards(): void {
  stopDockLayoutRetry();
  stopDockKeepalive();
  disconnectBgDivObserver();
  removeDockWindowListeners();
}

function installDockWindowListeners(): void {
  if (dockWindowListenersInstalled) return;
  dockWindowListenersInstalled = true;
  window.addEventListener('resize', onDockWindowSync);
  window.addEventListener('focus', onDockWindowSync);
  document.addEventListener('visibilitychange', onDockWindowSync);
}

function removeDockWindowListeners(): void {
  if (!dockWindowListenersInstalled) return;
  dockWindowListenersInstalled = false;
  window.removeEventListener('resize', onDockWindowSync);
  window.removeEventListener('focus', onDockWindowSync);
  document.removeEventListener('visibilitychange', onDockWindowSync);
}

function onDockWindowSync(): void {
  if (notifyingResize || reservedPanelWidth <= 0) return;
  // Do not force: focus/visibility often fire with unchanged size and would
  // spam GAME_ADAPTATION. Real window resize still changes gameWidth.
  applyDockedViewportLayout(false);
}

function watchGameBackground(gameBackground: HTMLElement | null | undefined): void {
  if (!gameBackground || watchedBgDiv === gameBackground) return;
  disconnectBgDivObserver();
  watchedBgDiv = gameBackground;
  bgDivObserver = new MutationObserver(() => {
    if (reservedPanelWidth <= 0) return;
    enforceBgDivWidth(gameBackground);
  });
  bgDivObserver.observe(gameBackground, {
    attributes: true,
    attributeFilter: ['style', 'class']
  });
}

function disconnectBgDivObserver(): void {
  bgDivObserver?.disconnect();
  bgDivObserver = undefined;
  watchedBgDiv = undefined;
}

function enforceBgDivWidth(gameBackground: HTMLElement): void {
  const expected = `${getAvailableGameWidth()}px`;
  const current = gameBackground.style.getPropertyValue('width').trim();
  if (current === expected) return;
  gameBackground.style.setProperty('width', expected, 'important');
}

function ensureLayaClientWidthOverride(): void {
  if (!dockingSnapshot || dockingSnapshot.layaClientWidthDescriptor) return;
  const layaBrowser = (window as any).Laya?.Browser as object | undefined;
  if (!layaBrowser) return;
  dockingSnapshot.layaBrowser = layaBrowser;
  dockingSnapshot.layaClientWidthDescriptor = Object.getOwnPropertyDescriptor(layaBrowser, 'clientWidth');
  installLayaClientWidthOverride(layaBrowser);
}

function getAvailableGameWidth(): number {
  return Math.max(320, document.documentElement.clientWidth - reservedPanelWidth);
}

function installLayaClientWidthOverride(layaBrowser: object | undefined): void {
  if (!layaBrowser) return;
  const descriptor = Object.getOwnPropertyDescriptor(layaBrowser, 'clientWidth');
  if (!descriptor?.configurable || typeof descriptor.get !== 'function') return;
  if (descriptor.get === getAvailableGameWidth) return;
  Object.defineProperty(layaBrowser, 'clientWidth', {
    configurable: descriptor.configurable,
    enumerable: descriptor.enumerable,
    get: getAvailableGameWidth
  });
}

function requestGameResize(): void {
  if (notifyingResize) return;
  notifyingResize = true;
  try {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('SGSresize'));
  } finally {
    notifyingResize = false;
  }
}
