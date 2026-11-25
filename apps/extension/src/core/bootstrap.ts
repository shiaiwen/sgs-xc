/**
 * 小抄核心启动器（Electron / 油猴共用）。
 *
 * 组装：配置仓库、游戏事件总线、卡牌目录、明牌引擎、各功能控制器，
 * 以及 Vue 面板挂载与 `__XIAOCHAO_ENGINEERING__` 运行时桥。
 * 平台差异只通过 PlatformAdapter 注入；协议改写过滤器在消息源上串联。
 */

import { createLifecycle } from '../runtime/lifecycle.js';
import { installStallMonitor } from '../runtime/perf-monitor';
import { ACCOUNT_SESSION_SYNC_MS } from '../const/poll-intervals';
import {
  getMissingGameRuntimeDependencies,
  installRuntimeBridge,
  waitForGameRuntime
} from '../runtime/wait-for-game-runtime.js';
import {
  describeHallStartupProbe,
  isHallLoginTransitionLoading,
  isXiaochaoGameplayUiReady
} from '../features/skin-background/skin-runtime';
import { createLayaObjectLocator, type LayaRuntimeWindow } from '../adapters/laya-object-locator';
import type { PlatformAdapter } from '../adapters/platform';
import {
  mountXiaochaoApp,
  type XiaochaoPanelLayout
} from '../ui/mount-xiaochao-app';
import { createConfigStore } from '../config/config-store';
import { createPlatformConfigStorage, NO_CONFIG_ACCOUNT } from '../config/config-storage';
import { startAccountConfigSync } from '../config/account-config-sync';
import { ACCOUNT_ID_WAIT_MS, PANEL_STARTUP_CHECK_MS } from '../const/panel-startup';
import { installSeatDisplayVisibility } from '../features/seat-display/seat-display-visibility';
import { createSeatStateStore } from '../features/seat-display/seat-state-store';
import { isNationWarMode } from '../features/seat-display/seat-state';
import { installSeatStateController } from '../features/seat-display/seat-state-controller';
import { createGameEventBus } from '../runtime/game-event-bus';
import { createRecentCardStore } from '../features/recent-cards/recent-card-store';
import { installGameLifecycleEvents } from '../runtime/game-lifecycle-events';
import { installNativeHudPostGameGuard } from '../runtime/native-hud-post-game-guard';
import { installGameNativePopupProtector } from '../runtime/game-native-dialog';
import { disposeOrphanTipStayHooks } from '../runtime/dispose-orphan-game-ui-hooks';
import { installMicroClientMessageSource } from '../adapters/micro-client-message-source';
import { installMicroClientFocusBridge } from '../runtime/micro-client-focus';
import { createGameCardCatalog } from '../features/cards/game-card-catalog';
import { locateGameScene } from '../features/seat-display/game-scene-locator';
import { bindTurnStatusStoreToGameEvents, createTurnStatusStore } from '../features/turn-status/turn-status-store';
import { createDeckRecordStore } from '../features/deck-record/deck-record-store';
import { createDeckRecordInteraction } from '../features/deck-record/deck-record-interaction';
import { installNativeDeckRecordController } from '../features/deck-record/native-deck-record-controller';
import { installCountdownSecondsController } from '../features/countdown/countdown-seconds-controller';
import { installCardLabelController } from '../features/cards/card-label-controller';
import { installAiPlayerTipController } from '../features/ai-player/ai-player-tip-controller';
import { installChooseFigureController } from '../features/identity-drill/choose-figure-controller';
import { installCardConfigSource } from '../adapters/card-config-source';
import { installNativeRecentCardController } from '../features/recent-cards/native-recent-card-controller';
import { createMingpaiEngine, installMingpaiController } from '../features/mingpai';
import { installNativeMingpaiPreviewController } from '../features/mingpai/native-mingpai-preview-controller';
import { mingpaiPerf } from '../features/mingpai/mingpai-perf.ts';
import { createSkillAssistStore } from '../features/skill-assist/skill-assist-store';
import { assignYanjiaoCards } from '../features/skill-assist/yanjiao-assign';
import { SKILL_ASSIST_DEFINITIONS } from '../features/skill-assist/skill-definitions';
import { installSkillAssistController } from '../features/skill-assist/skill-assist-controller';
import { registerSpellNameLookup } from '../features/skill-assist/skill-visibility';
import { installBlockEffectsController } from '../features/block-effects/block-effects-controller';
import {
  installOfficialBackgroundController,
  type OfficialBackgroundController
} from '../features/skin-background/official-background-controller';
import { installSkinChangeController } from '../features/skin-background/skin-change-controller';
import { installSkinPaperController } from '../features/skin-background/skin-paper-controller';
import { installAutoTaskController } from '../features/auto-task';
// 临时关闭周年庆入口，方便以后恢复。
// import { installAnniversaryAssistController } from '../features/anniversary-assist';
// import { setAnniversaryAssistController } from '../features/anniversary-assist/anniversary-assist-registry';
import { installDdzShopAutoExchange } from '../features/ddz-shop/ddz-shop-auto-exchange';
import { installShanhetuController } from '../features/shanhetu';
import { createPeixiuRouteStore, installExtraAssistController } from '../features/extra-assist';
import { installAutoHgController } from '../features/auto-hg';
import { installAutoBotController } from '../features/auto-bot';
import { installUpdateNoticeController } from '../features/update-notice';
import { installGiftCodeController } from '../features/gift-code';
import { installSecKillController } from '../features/sec-kill/sec-kill-controller';
import { installRuntimeSearchController } from '../features/runtime-search';
import { installHandSortController } from '../features/cards/hand-sort-controller';
import { installTiesuoRecastController } from '../features/cards/tiesuo-recast-controller';
import { installClassicRoomFilterController } from '../features/room-filter/classic-room-filter-controller';
import { installRoomSeatIpGuard } from '../features/room-filter/room-seat-ip-guard.ts';
import { installCampChatRightPanelController } from '../features/in-game-chat/camp-chat-right-panel';
import {
  ensureSkinTraceDiagnostics,
  installSkinTraceConsoleBridge,
  skinTrace
} from '../features/skin-background/skin-runtime.ts';

/** 挂到 window.__XIAOCHAO_STARTUP__，方便控制台看 waiting/ready。 */
const panelStartupStatus: Record<string, unknown> = {};

/** preboot 会先写入 __XIAOCHAO_STARTUP__，bootstrap 必须合并到同一对象再更新 state。 */
function bindPanelStartupStatus(globalObject: Record<string, unknown>): Record<string, unknown> {
  const existing = globalObject.__XIAOCHAO_STARTUP__;
  if (existing && typeof existing === 'object' && existing !== panelStartupStatus) {
    Object.assign(panelStartupStatus, existing as Record<string, unknown>);
  }
  globalObject.__XIAOCHAO_STARTUP__ = panelStartupStatus;
  ensureSkinTraceDiagnostics(globalObject);
  return panelStartupStatus;
}

function pageStorage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

/** 核心装好后对外暴露的面板挂载 / 会话同步句柄。 */
interface XiaochaoCoreRuntime {
  mountPanelShell(layout?: XiaochaoPanelLayout): ReturnType<typeof mountXiaochaoApp> | undefined;
  teardownPanel(): void;
  startAccountActions(): void;
}

/** Electron 和油猴共用的启动边界；平台差异只能通过 adapter 注入。 */
export function bootstrapXiaochao(platform: PlatformAdapter): void {
  const bootBag = window as unknown as Record<string, unknown>;
  const prevBootDispose = bootBag.__xcXiaochaoBootstrapDispose;
  // 入口被重复执行时先拆掉上一轮生命周期，避免 ShowWindow/_ 重复包装栈溢出
  if (typeof prevBootDispose === 'function') {
    try { (prevBootDispose as () => void)(); } catch (error) {
      console.error('[xiaochao] previous bootstrap dispose failed', error);
    }
    delete bootBag.__xcXiaochaoBootstrapDispose;
  }
  const prevPopupProtector = bootBag.__xcGameNativePopupProtectorDispose;
  if (typeof prevPopupProtector === 'function') {
    try { (prevPopupProtector as () => void)(); } catch (error) {
      console.error('[xiaochao] previous popup protector dispose failed', error);
    }
    delete bootBag.__xcGameNativePopupProtectorDispose;
  }
  disposeOrphanTipStayHooks(window);
  const lifecycle = createLifecycle();
  lifecycle.register(installStallMonitor(window));
  // popup protector：只卸旧守卫；技能 tip 停驻等进大厅后再挂，避免登录初始化链被打断
  lifecycle.register(installGameNativePopupProtector(window));
  const configStore = createConfigStore(createPlatformConfigStorage(platform));
  bootBag.__xcXiaochaoBootstrapDispose = () => {
    lifecycle.dispose();
  };
  const accountConfigSync = startAccountConfigSync({
    configStore,
    storage: pageStorage(),
    onPullSettled: () => syncAccountSession()
  });
  lifecycle.register(() => accountConfigSync.dispose());
  const startupStatus = bindPanelStartupStatus(bootBag);
  installSkinTraceConsoleBridge(bootBag);
  startupStatus.state = 'starting';
  startupStatus.panelGate = 'login-transition-only';

  let core: XiaochaoCoreRuntime | null = null;
  let tipHooksCleanedAfterRuntime = false;
  let runtimeReadyAt: number | null = null;
  let coreStartError: unknown = null;
  let startupTimer: number | undefined;
  let nextHallDiagnosticAt = 0;

  const probeRuntimeReady = () => {
    const missing = getMissingGameRuntimeDependencies({ globalObject: window });
    if (missing.length > 0) return missing;
    const globalObject = window as LayaRuntimeWindow;
    if (!globalObject.Laya) return ['LayaRuntime'];
    const locator = createLayaObjectLocator(globalObject);
    if (locator.gameScene()) return [];
    if (!isXiaochaoGameplayUiReady(locator, globalObject)) return ['GameHallUi'];
    return [];
  };

  /**
   * 启动时尽快检测游戏和账号；挂载后以常驻间隔同步账号。
   * 官网和登录页没有游戏运行时，先不启动功能、也不挂面板。进了游戏再挂。
   */
  const syncAccountSession = () => {
    if (lifecycle.disposed || coreStartError) return;
    const missing = probeRuntimeReady();
    startupStatus.missing = missing;
    if (missing.includes('GameHallUi') && Date.now() >= nextHallDiagnosticAt) {
      nextHallDiagnosticAt = Date.now() + ACCOUNT_SESSION_SYNC_MS;
      const locator = createLayaObjectLocator(window as LayaRuntimeWindow);
      startupStatus.hallProbe = describeHallStartupProbe(locator, window as LayaRuntimeWindow);
    } else if (!missing.includes('GameHallUi')) {
      delete startupStatus.hallProbe;
    }
    const gameReady = Boolean(document.body) && missing.length === 0;
    if (core || gameReady) {
      configStore.syncAccount();
      accountConfigSync.checkAccount();
    }
    if (!gameReady) {
      if (!core) startupStatus.state = 'waiting';
      return;
    }
    if (!core) {
      // 先等读到账号编号，免得功能先按默认配置跑一段再换成这个号自己的配置。
      runtimeReadyAt ??= Date.now();
      const waitingForAccount = configStore.account() === NO_CONFIG_ACCOUNT
        && Date.now() - runtimeReadyAt < ACCOUNT_ID_WAIT_MS;
      if (waitingForAccount) {
        startupStatus.state = 'waiting';
        startupStatus.missing = ['GameAccountId'];
        return;
      }
      try {
        const started = startXiaochaoCore(platform, lifecycle, configStore, accountConfigSync);
        // 面板几何先用当前账号的本地值。云同步更新配置仓库时无需重挂面板。
        started.mountPanelShell();
        core = started;
      } catch (error) {
        // 启动到一半失败时，已经装上的功能还在；再试一次会把它们叠装一遍，背景等会反复重画闪屏。
        coreStartError = error;
        startupStatus.state = 'failed';
        startupStatus.error = String((error as Error)?.message ?? error);
        console.error('[xiaochao] 启动失败', error);
        return;
      }
    }
    if (!tipHooksCleanedAfterRuntime) {
      tipHooksCleanedAfterRuntime = true;
      disposeOrphanTipStayHooks(window);
    }
    core.mountPanelShell();
    startupStatus.state = 'ready';
    if (configStore.account() !== NO_CONFIG_ACCOUNT && !accountConfigSync.awaitingServer()) {
      core.startAccountActions();
    }
  };

  // 先装瘦桥，供注入早期调试；core 就绪后会再装一次带完整 getter 的桥
  installRuntimeBridge(window, {
    lifecycle,
    platform,
    getMissingGameRuntimeDependencies,
    waitForGameRuntime,
    mountPanelShell: () => core?.mountPanelShell()
  });

  function checkStartup(): void {
    startupTimer = undefined;
    if (lifecycle.disposed) return;
    syncAccountSession();
    if (!core && !coreStartError) {
      startupTimer = window.setTimeout(checkStartup, PANEL_STARTUP_CHECK_MS);
    }
  }

  lifecycle.register(() => {
    if (startupTimer !== undefined) window.clearTimeout(startupTimer);
  });
  checkStartup();

  // 页面回到前台时补一次账号同步与面板自愈，不再 1s 轮询。
  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible' || lifecycle.disposed || !core) return;
    configStore.syncAccount();
    accountConfigSync.checkAccount();
    core.mountPanelShell();
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
  lifecycle.register(() => document.removeEventListener('visibilitychange', onVisibilityChange));
}

/**
 * 一次性装齐各功能控制器与消息过滤器；返回面板挂载句柄。
 * 调用方保证 document.body 已存在；失败项（如自动任务）降级为 no-op，不拖垮面板。
 */
function startXiaochaoCore(
  platform: PlatformAdapter,
  lifecycle: ReturnType<typeof createLifecycle>,
  configStore: ReturnType<typeof createConfigStore>,
  accountConfigSync: ReturnType<typeof startAccountConfigSync>
): XiaochaoCoreRuntime {
  const seatStateStore = createSeatStateStore();
  const gameEvents = createGameEventBus();
  const cardConfigSource = installCardConfigSource(window);
  const gameCardCatalog = createGameCardCatalog(
    () => locateGameScene(window),
    (cardId) => cardConfigSource.getCard(cardId)
  );
  const recentCardStore = createRecentCardStore(
    gameEvents,
    configStore.get('display.recentCardMode')
  );
  const mingpaiEngine = createMingpaiEngine();
  const cardLabels = installCardLabelController(configStore, window, gameEvents, cardConfigSource);
  const deckRecordInteraction = createDeckRecordInteraction();
  const mingpaiRuntime = installMingpaiController(seatStateStore, gameEvents, {
    engine: mingpaiEngine,
    onCardLabelMovement: cardLabels.recordMovement,
    isRedCard: (cardId) => {
      const card = gameCardCatalog.resolve(cardId);
      return card?.suit ? card.isRed : null;
    },
    cardType: (cardId) => gameCardCatalog.resolve(cardId).cardType,
  });
  // 明牌控制器先订阅游戏事件，牌局记录随后读取引擎更新后的弃牌区差异，
  // 以补齐浏览器端移牌协议里偶尔缺失的 CardIDs。
  const deckRecordStore = createDeckRecordStore(gameEvents, undefined, {
    getDrawPile: () => mingpaiEngine.getSnapshot().drawPile,
    getKnownDiscardCardIds: () => mingpaiEngine.getSnapshot().records
      .filter((record) => record.location?.zone === 2)
      .map((record) => record.cardId),
    subscribe: (listener) => mingpaiEngine.subscribe(listener)
  });
  registerSpellNameLookup((name) => cardConfigSource.findSpellIdsByName(name));
  const skillAssistStore = createSkillAssistStore(
    mingpaiEngine,
    gameCardCatalog,
    {
      isSelfSeat(seatId) {
        const snapshot = seatStateStore.getSnapshot();
        return seatId === snapshot.selfSeatId
          || snapshot.controlledSeatIds.includes(seatId);
      },
      getControlledSeatIds() {
        const snapshot = seatStateStore.getSnapshot();
        const seatIds = snapshot.selfSeatId === null ? [] : [snapshot.selfSeatId];
        return [...new Set([...seatIds, ...snapshot.controlledSeatIds])];
      },
      getSeatLabel(seatId) {
        return seatStateStore.getSnapshot().seats.find((seat) => seat.seatId === seatId)?.playerName ?? '';
      },
      isNationWar() {
        return isNationWarMode(seatStateStore.getSnapshot().mode);
      }
    },
    SKILL_ASSIST_DEFINITIONS,
    {
      assignYanjiao(split, selfSide, rankOfCardId) {
        return assignYanjiaoCards(window as LayaRuntimeWindow, split, selfSide, rankOfCardId, (seatIndex) => {
          const snapshot = seatStateStore.getSnapshot();
          return seatIndex === snapshot.selfSeatId || snapshot.controlledSeatIds.includes(seatIndex);
        });
      }
    }
  );
  const peixiuRouteStore = createPeixiuRouteStore();
  lifecycle.register(cardConfigSource.dispose);
  lifecycle.register(installSeatDisplayVisibility(configStore));
  const classicRoomFilter = installClassicRoomFilterController(configStore);
  lifecycle.register(classicRoomFilter.dispose);
  const roomSeatIpGuard = installRoomSeatIpGuard(window, gameEvents);
  lifecycle.register(roomSeatIpGuard.dispose);
  lifecycle.register(installCampChatRightPanelController(window, gameEvents).dispose);
  lifecycle.register(installSeatStateController(seatStateStore, window, { gameEvents }));
  lifecycle.register(installGameLifecycleEvents(seatStateStore, gameEvents));
  lifecycle.register(gameEvents.subscribe((event) => {
    if (event.type === 'game-started') {
      disposeOrphanTipStayHooks(window);
    }
  }));
  lifecycle.register(installNativeHudPostGameGuard(gameEvents, window));
  // 微端里点进输入框时把系统键盘焦点交回 webview，否则中文输入法打不进去。
  lifecycle.register(installMicroClientFocusBridge(window));
  lifecycle.register(mingpaiRuntime.dispose);
  lifecycle.register(installNativeMingpaiPreviewController(configStore, seatStateStore, gameCardCatalog, mingpaiEngine, gameEvents));
  lifecycle.register(installCountdownSecondsController(configStore, window, gameEvents));
  lifecycle.register(cardLabels.dispose);
  lifecycle.register(installAiPlayerTipController(gameEvents, window));
  lifecycle.register(installChooseFigureController(window, gameEvents));
  lifecycle.register(installHandSortController(configStore, window, gameEvents));
  lifecycle.register(installTiesuoRecastController(gameEvents));
  const blockEffects = installBlockEffectsController(configStore, { gameEvents });
  lifecycle.register(blockEffects.dispose);
  const skinChange = installSkinChangeController(configStore, { gameEvents });
  lifecycle.register(skinChange.dispose);
  // skinPaper 与 officialBackground 互相引用菜单扩展，先占位再回填
  let officialBackground: OfficialBackgroundController | undefined;
  const skinPaper = installSkinPaperController(configStore, {
    selfSeatId: () => seatStateStore.getSnapshot().selfSeatId,
    syncWallpaperMenu: () => officialBackground?.sync(),
    prepareOfficialSkinTab: (menu) => officialBackground?.prepareOfficialSkinTab(menu),
    gameEvents
  });
  lifecycle.register(skinPaper.dispose);
  officialBackground = installOfficialBackgroundController(configStore, {
    menuExtension: skinPaper.menuExtension
  });
  const startupSnapshot = window.__XIAOCHAO_STARTUP__ as Record<string, unknown> | undefined;
  if (startupSnapshot) {
    startupSnapshot.wallpaperController = 'installed';
    startupSnapshot.skinPaperEnabled = configStore.get('skin.skinPaper') === true;
  }
  const globalBoot = window as unknown as Record<string, unknown>;
  installSkinTraceConsoleBridge(globalBoot);
  skinTrace('skin-background-installed', {
    skinPaper: configStore.get('skin.skinPaper') === true,
    officialBackground: configStore.get('skin.officialBackground') === true
  });
  lifecycle.register(officialBackground.dispose);
  lifecycle.register(installRuntimeSearchController());
  const secKill = installSecKillController();
  lifecycle.register(secKill.dispose);
  const extraAssist = installExtraAssistController(configStore, {
    getExtraAssistData: () => cardConfigSource.getExtraAssistData(),
    getSpellExtendRaw: () => cardConfigSource.getSpellExtendRaw(),
    getCard: (cardId) => cardConfigSource.getCard(cardId),
    peixiuRouteStore,
    gameEvents
  });
  lifecycle.register(extraAssist.dispose);
  const updateNotice = installUpdateNoticeController(configStore, platform);
  lifecycle.register(updateNotice.dispose);
  const shanhetu = installShanhetuController(configStore, {
    cardConfigSource,
    gameEvents,
    selfSeatId: () => seatStateStore.getSnapshot().selfSeatId
  });
  lifecycle.register(shanhetu.dispose);
  // 入站协议改写链：任一过滤器抛错只打日志，不阻断后续过滤器
  const messageFilters = [
    blockEffects.filterMessage,
    skinChange.filterMessage,
    skinPaper.filterMessage,
    shanhetu.filterMessage,
    roomSeatIpGuard.filterMessage
  ];
  let accountActionsStarted = false;
  function startAccountActions(): void {
    if (accountActionsStarted) return;
    accountActionsStarted = true;
    try {
      lifecycle.register(installAutoTaskController(configStore, gameEvents, { cardConfigSource }).dispose);
    } catch (error) {
      console.error('[xiaochao] 自动领取初始化失败，面板仍可用', error);
    }
    // 临时关闭周年庆入口，方便以后恢复。
    // try {
    //   const anniversaryAssist = installAnniversaryAssistController(configStore, gameEvents, window);
    //   setAnniversaryAssistController(anniversaryAssist);
    //   lifecycle.register(() => {
    //     anniversaryAssist.dispose();
    //     setAnniversaryAssistController(null);
    //   });
    // } catch (error) {
    //   console.error('[xiaochao] 周年庆互助初始化失败，面板仍可用', error);
    // }
    try {
      lifecycle.register(installDdzShopAutoExchange({ cardConfigSource }));
      lifecycle.register(installGiftCodeController({ configStore }));
      const autoHg = installAutoHgController(configStore, { gameEvents });
      lifecycle.register(autoHg.dispose);
      messageFilters.push(autoHg.filterMessage);
      const autoBot = installAutoBotController(configStore, { gameEvents });
      lifecycle.register(autoBot.dispose);
      messageFilters.push(autoBot.filterMessage);
    } catch (error) {
      console.error('[xiaochao] 账号自动操作初始化失败，面板仍可用', error);
    }
  }
  lifecycle.register(installMicroClientMessageSource(gameEvents, window, {
    mutateMessage: (payload, className) => {
      // 登录协议回包：账号可能已切换，立刻同步账号配置，不再 1s 轮询。
      if (/ClientLoginRep/i.test(className)) {
        try {
          configStore.syncAccount();
          accountConfigSync.checkAccount();
        } catch (error) {
          console.warn('[xiaochao] 登录后账号同步失败', error);
        }
      }
      for (const filter of messageFilters) {
        try {
          filter(payload, className);
        } catch (error) {
          console.warn('[xiaochao] 协议改写失败', className, error);
        }
      }
    }
  }));
  lifecycle.register(installNativeRecentCardController(configStore, recentCardStore, gameEvents));
  lifecycle.register(installNativeDeckRecordController(
    configStore,
    deckRecordStore,
    deckRecordInteraction,
    gameCardCatalog,
    gameEvents
  ));
  lifecycle.register(installSkillAssistController(
    skillAssistStore,
    gameEvents,
    () => locateGameScene(window)
  ));
  const turnStatusStore = createTurnStatusStore();
  lifecycle.register(bindTurnStatusStoreToGameEvents(turnStatusStore, gameEvents));
  lifecycle.register(turnStatusStore.clear);
  lifecycle.register(recentCardStore.clear);
  lifecycle.register(gameEvents.clear);
  lifecycle.register(gameCardCatalog.clear);
  lifecycle.register(deckRecordStore.clear);
  lifecycle.register(deckRecordInteraction.clear);
  lifecycle.register(skillAssistStore.clear);
  lifecycle.register(peixiuRouteStore.clear);
  lifecycle.register(mingpaiEngine.clear);
  let mountedApp: ReturnType<typeof mountXiaochaoApp> | undefined;
  function mountPanelShell(layout: XiaochaoPanelLayout = DEFAULT_PANEL_LAYOUT) {
    // 面板节点被宿主页面移除后允许重新创建。
    if (mountedApp?.panelElement.isConnected) return mountedApp;
    mountedApp?.unmount();
    mountedApp = mountXiaochaoApp(
      platform.platform,
      layout,
      configStore,
      recentCardStore,
      deckRecordStore,
      gameCardCatalog,
      skillAssistStore,
      peixiuRouteStore,
      turnStatusStore,
      shanhetu,
      updateNotice,
      secKill
    );
    lifecycle.register(mountedApp.unmount);
    return mountedApp;
  }
  function teardownPanel(): void {
    if (!mountedApp) return;
    mountedApp.unmount();
    mountedApp = undefined;
  }
  // 用完整调试 getter 覆盖启动早期的瘦桥
  installRuntimeBridge(window, {
    lifecycle,
    platform,
    getMissingGameRuntimeDependencies,
    waitForGameRuntime,
    mingpaiNativePerf: mingpaiPerf,
    getSeatState: () => seatStateStore.getSnapshot(),
    getRecentCardState: () => recentCardStore.getSnapshot(),
    getDeckRecordState: () => deckRecordStore.getSnapshot(),
    getMingpaiState: () => mingpaiEngine.getSnapshot(),
    getSkillAssistState: () => skillAssistStore.getSnapshot(),
    resolveGameCard: (cardId: number) => gameCardCatalog.resolve(cardId),
    getCardConfigSize: () => cardConfigSource.size(),
    mountPanelShell
  });
  return {
    mountPanelShell,
    teardownPanel,
    startAccountActions
  };
}

/** 面板初始几何。展开高度跟着账号配置走，挂面板时再读。 */
const DEFAULT_PANEL_LAYOUT: XiaochaoPanelLayout = {
  top: 31,
  right: 155,
  width: '250px',
  fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Noto Sans SC",Arial,sans-serif'
};


