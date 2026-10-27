/**
 * 右停靠时压缩游戏画布区域；解除停靠后恢复全宽。
 */

interface DockingSnapshot {
  padding: unknown;
  backgroundWidth: string;
  backgroundWidthPriority: string;
  layaBrowser: object | undefined;
  layaClientWidthDescriptor: PropertyDescriptor | undefined;
  /** 原始 clientWidth getter，扣除侧栏时以它为基数。 */
  originalClientWidthGet: (() => number) | undefined;
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
    const descriptor = layaBrowser
      ? Object.getOwnPropertyDescriptor(layaBrowser, 'clientWidth')
      : undefined;
    const originalGet =
      descriptor && typeof descriptor.get === 'function'
        ? (descriptor.get as () => number).bind(layaBrowser)
        : undefined;
    dockingSnapshot = {
      padding: (window as any).padding,
      backgroundWidth: gameBackground?.style.getPropertyValue('width') || '',
      backgroundWidthPriority: gameBackground?.style.getPropertyPriority('width') || '',
      layaBrowser,
      layaClientWidthDescriptor: descriptor,
      originalClientWidthGet: originalGet
    };
    installLayaClientWidthOverride(layaBrowser);
    installDockWindowListeners();
  } else {
    // 快照已在、但上次 Laya 未就绪或 override 未挂上时补装。
    ensureLayaClientWidthOverride();
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
  // 同步裁切常见 Laya 画布容器，避免只缩 bgDiv、canvas 仍全宽叠在侧栏下。
  enforceGameCanvasHostWidth(gameWidth);
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
    // 前几次强制通知：拖贴右后布局变量刚写入时，需让 UpdateGameSize 吃到新的 clientWidth。
    applyDockedViewportLayout(attempts <= 5);
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

function enforceGameCanvasHostWidth(gameWidth: number): void {
  const expected = `${gameWidth}px`;
  // 只收 DOM 容器；canvas 宽高交给 Laya.stage.setScreenSize（由 clientWidth override + resize 驱动）。
  for (const id of ['layaContainer', 'laya_container', 'GameDiv']) {
    const el = document.getElementById(id);
    if (!el) continue;
    if (el.style.getPropertyValue('width').trim() !== expected) {
      el.style.setProperty('width', expected, 'important');
      el.style.setProperty('max-width', expected, 'important');
    }
  }
}

function ensureLayaClientWidthOverride(): void {
  if (!dockingSnapshot) return;
  const layaBrowser = (window as any).Laya?.Browser as object | undefined;
  if (!layaBrowser) return;

  const current = Object.getOwnPropertyDescriptor(layaBrowser, 'clientWidth');
  if (current?.get === getAvailableGameWidth) {
    dockingSnapshot.layaBrowser = layaBrowser;
    return;
  }

  // Laya 晚于首次停靠出现，或先前 install 失败：重新抓原始 getter 并挂上。
  if (!dockingSnapshot.layaClientWidthDescriptor || dockingSnapshot.layaBrowser !== layaBrowser) {
    dockingSnapshot.layaBrowser = layaBrowser;
    dockingSnapshot.layaClientWidthDescriptor = current;
    dockingSnapshot.originalClientWidthGet =
      current && typeof current.get === 'function'
        ? (current.get as () => number).bind(layaBrowser)
        : dockingSnapshot.originalClientWidthGet;
  }
  installLayaClientWidthOverride(layaBrowser);
}

function getAvailableGameWidth(): number {
  const original = dockingSnapshot?.originalClientWidthGet;
  let base = 0;
  if (original) {
    try {
      base = Number(original()) || 0;
    } catch {
      base = 0;
    }
  }
  if (!(base > 0)) {
    base = document.documentElement.clientWidth || window.innerWidth || 0;
  }
  return Math.max(320, base - reservedPanelWidth);
}

function installLayaClientWidthOverride(layaBrowser: object | undefined): void {
  if (!layaBrowser) return;
  const descriptor = Object.getOwnPropertyDescriptor(layaBrowser, 'clientWidth');
  if (!descriptor?.configurable) return;
  // 已是我们的 getter 则跳过。
  if (descriptor.get === getAvailableGameWidth) return;
  // 无 getter 时（偶发成 value）也尽量覆盖成 getter。
  Object.defineProperty(layaBrowser, 'clientWidth', {
    configurable: true,
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
    const Laya = (window as any).Laya;
    const stage = Laya?.stage;
    if (stage && typeof stage.event === 'function') {
      const type = Laya?.Event?.RESIZE || 'resize';
      try {
        stage.event(type);
      } catch {
        // 舞台未就绪时忽略。
      }
    }
    // 直调游戏适配入口（若已暴露），比只派 DOM resize 更稳。
    try {
      const njt = (window as any).Njt?.I?.();
      if (njt && typeof njt.ScreenSizeChange === 'function') {
        njt.ScreenSizeChange(false);
      }
    } catch {
      // 压缩名/未加载时忽略。
    }
  } finally {
    notifyingResize = false;
  }
}
