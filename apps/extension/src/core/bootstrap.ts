/**
 * 小抄核心启动器（Electron / 油猴共用）。
 *
 * 组装：配置仓库、游戏事件总线、卡牌目录、明牌引擎、各功能控制器，
 * 以及 Vue 面板挂载与 `__XIAOCHAO_ENGINEERING__` 运行时桥。
 * 平台差异只通过 PlatformAdapter 注入；协议改写过滤器在消息源上串联。
 */

import { createLifecycle } from '../runtime/lifecycle.js';
import {
  getMissingGameRuntimeDependencies,
  installRuntimeBridge,
  waitForGameRuntime
} from '../runtime/wait-for-game-runtime.js';
import { readBrowserSetting, removeBrowserSetting, writeBrowserSetting } from '../adapters/browser-settings';
import { accountScopedStorageKey } from '../features/skin-background/skin-runtime';
import type { PlatformAdapter } from '../adapters/platform';
import {
  mountXiaochaoApp,
  type XiaochaoPanelLayout
} from '../ui/mount-xiaochao-app';
import { createConfigStore } from '../config/config-store';
import { createPlatformConfigStorage } from '../config/config-storage';
import { installSeatDisplayVisibility } from '../features/seat-display/seat-display-visibility';
import { createSeatStateStore } from '../features/seat-display/seat-state-store';
import { isNationWarMode } from '../features/seat-display/seat-state';
import { installSeatStateController } from '../features/seat-display/seat-state-controller';
import { createGameEventBus } from '../runtime/game-event-bus';
import { createRecentCardStore } from '../features/recent-cards/recent-card-store';
import { installGameLifecycleEvents } from '../runtime/game-lifecycle-events';
import { installNativeHudPostGameGuard } from '../runtime/native-hud-post-game-guard';
import { installGeneralSkillTipStayCoordinator } from '../runtime/general-skill-tip-stay-coordinator';
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
import {
  installAiPlayerTipController,
  mountPlayNameProbe
} from '../features/ai-player/ai-player-tip-controller';
import { installChooseFigureController } from '../features/identity-drill/choose-figure-controller';
import { installCardConfigSource } from '../adapters/card-config-source';
import { installNativeRecentCardController } from '../features/recent-cards/native-recent-card-controller';
import { createMingpaiEngine, installMingpaiController } from '../features/mingpai';
import { installNativeMingpaiPreviewController } from '../features/mingpai/native-mingpai-preview-controller';
import { mingpaiPerf } from '../features/mingpai/mingpai-perf.ts';
import { createSkillAssistStore } from '../features/skill-assist/skill-assist-store';
import { installSkillAssistController } from '../features/skill-assist/skill-assist-controller';
import { registerSpellNameLookup } from '../features/skill-assist/skill-visibility';
import { installBlockEffectsController } from '../features/block-effects/block-effects-controller';
import { shouldDropNoticeProtocol } from '../features/block-effects/block-message-filters';
import {
  installOfficialBackgroundController,
  type OfficialBackgroundController
} from '../features/skin-background/official-background-controller';
import { installSkinChangeController } from '../features/skin-background/skin-change-controller';
import { installSkinPaperController } from '../features/skin-background/skin-paper-controller';
import { installAutoTaskController } from '../features/auto-task';
import { installShanhetuController } from '../features/shanhetu';
import { createPeixiuRouteStore, installExtraAssistController } from '../features/extra-assist';
import { installAutoHgController } from '../features/auto-hg';
import { installAutoBotController } from '../features/auto-bot';
import { installUpdateNoticeController } from '../features/update-notice';
import { installGiftCodeController } from '../features/gift-code';
import { installDiscountRechargeController } from '../features/discount-recharge';
import { installRuntimeSearchController } from '../features/runtime-search';
import { installHandSortController } from '../features/cards/hand-sort-controller';
import { installTiesuoRecastController } from '../features/cards/tiesuo-recast-controller';
import { installClassicRoomFilterController } from '../features/room-filter/classic-room-filter-controller';
import { installCampChatRightPanelController } from '../features/in-game-chat/camp-chat-right-panel';

const panelStartupStatus: Record<string, unknown> = {};

interface XiaochaoCoreRuntime {
  mountPanelShell(layout?: XiaochaoPanelLayout): ReturnType<typeof mountXiaochaoApp> | undefined;
  teardownPanel(): void;
  syncRuntimeSession(): void;
}

/** Electron 和油猴共用的启动边界；平台差异只能通过 adapter 注入。 */
export function bootstrapXiaochao(platform: PlatformAdapter): void {
  const lifecycle = createLifecycle();
  lifecycle.register(installGeneralSkillTipStayCoordinator(window));
  const configStore = createConfigStore(createPlatformConfigStorage(platform));
  (window as unknown as Record<string, unknown>).__XIAOCHAO_STARTUP__ ??= panelStartupStatus;

  let core: XiaochaoCoreRuntime | null = null;

  const probeRuntimeReady = () => getMissingGameRuntimeDependencies({ globalObject: window });

  const syncAccountSession = () => {
    configStore.syncAccount();
    const missing = probeRuntimeReady();
    panelStartupStatus.missing = missing;
    if (!document.body) {
      if (!core) panelStartupStatus.state = 'waiting';
      return;
    }
    if (!core) core = startXiaochaoCore(platform, lifecycle, configStore);
    core.mountPanelShell();
    if (missing.length > 0) {
      panelStartupStatus.state = 'degraded';
      return;
    }
    core.syncRuntimeSession();
    panelStartupStatus.state = 'ready';
  };

  installRuntimeBridge(window, {
    lifecycle,
    platform,
    getMissingGameRuntimeDependencies,
    waitForGameRuntime,
    mountPanelShell: () => core?.mountPanelShell()
  });

  const sessionTimer = window.setInterval(syncAccountSession, 1000);
  lifecycle.register(() => window.clearInterval(sessionTimer));
  syncAccountSession();

  void waitForGameRuntime({
    probe: probeRuntimeReady,
    initialize: () => {
      syncAccountSession();
      return true;
    },
    registerCleanup: (cleanup) => lifecycle.register(cleanup),
    status: panelStartupStatus
  }).catch((error: unknown) => console.error('[xiaochao] 启动失败', error));
}

function startXiaochaoCore(
  platform: PlatformAdapter,
  lifecycle: ReturnType<typeof createLifecycle>,
  configStore: ReturnType<typeof createConfigStore>
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
  const deckRecordInteraction = createDeckRecordInteraction();
  const mingpaiRuntime = installMingpaiController(seatStateStore, gameEvents, {
    engine: mingpaiEngine,
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
    }
  );
  const peixiuRouteStore = createPeixiuRouteStore();
  lifecycle.register(cardConfigSource.dispose);
  lifecycle.register(installSeatDisplayVisibility(configStore));
  const classicRoomFilter = installClassicRoomFilterController(configStore);
  lifecycle.register(classicRoomFilter.dispose);
  lifecycle.register(installCampChatRightPanelController(window).dispose);
  lifecycle.register(installSeatStateController(seatStateStore));
  lifecycle.register(installGameLifecycleEvents(seatStateStore, gameEvents));
  lifecycle.register(installNativeHudPostGameGuard(gameEvents, window));
  // 微端里点进输入框时把系统键盘焦点交回 webview，否则中文输入法打不进去。
  lifecycle.register(installMicroClientFocusBridge(window));
  lifecycle.register(mingpaiRuntime.dispose);
  lifecycle.register(installNativeMingpaiPreviewController(configStore, seatStateStore, gameCardCatalog, mingpaiEngine, gameEvents));
  lifecycle.register(installCountdownSecondsController(configStore));
  lifecycle.register(installCardLabelController(configStore));
  lifecycle.register(installAiPlayerTipController(gameEvents, window));
  lifecycle.register(installChooseFigureController(window, gameEvents));
  lifecycle.register(installHandSortController(configStore));
  lifecycle.register(installTiesuoRecastController());
  const blockEffects = installBlockEffectsController(configStore, { gameEvents });
  lifecycle.register(blockEffects.dispose);
  const skinChange = installSkinChangeController(configStore, { gameEvents });
  lifecycle.register(skinChange.dispose);
  let officialBackground: OfficialBackgroundController | undefined;
  const skinPaper = installSkinPaperController(configStore, {
    selfSeatId: () => seatStateStore.getSnapshot().selfSeatId,
    syncWallpaperMenu: () => officialBackground?.sync()
  });
  lifecycle.register(skinPaper.dispose);
  officialBackground = installOfficialBackgroundController(configStore, {
    menuExtension: skinPaper.menuExtension
  });
  lifecycle.register(officialBackground.dispose);
  let autoTask: ReturnType<typeof installAutoTaskController>;
  try {
    autoTask = installAutoTaskController(configStore, gameEvents, {
      cardConfigSource
    });
  } catch (error) {
    console.error('[xiaochao] 自动领取初始化失败，面板仍可用', error);
    autoTask = {
      schedule: () => false,
      getStatus: () => ({
        phase: 'idle',
        lastReason: '',
        lastStartedAt: 0,
        lastFinishedAt: 0,
        message: '自动领取未加载'
      }),
      subscribe: () => () => {},
      dispose: () => {}
    };
  }
  lifecycle.register(autoTask.dispose);
  lifecycle.register(installGiftCodeController());
  lifecycle.register(installDiscountRechargeController({
    openExternal: (url) => platform.openExternal(url)
  }));
  lifecycle.register(installRuntimeSearchController());
  const extraAssist = installExtraAssistController(configStore, {
    getExtraAssistData: () => cardConfigSource.getExtraAssistData(),
    getSpellExtendRaw: () => cardConfigSource.getSpellExtendRaw(),
    getCard: (cardId) => cardConfigSource.getCard(cardId),
    peixiuRouteStore,
    gameEvents
  });
  lifecycle.register(extraAssist.dispose);
  const autoHg = installAutoHgController(configStore, { gameEvents });
  lifecycle.register(autoHg.dispose);
  const autoBot = installAutoBotController(configStore, { gameEvents });
  lifecycle.register(autoBot.dispose);
  const updateNotice = installUpdateNoticeController(configStore, (url) => platform.openExternal(url), {
    platform: platform.platform
  });
  lifecycle.register(updateNotice.dispose);
  const shanhetu = installShanhetuController(configStore, {
    cardConfigSource,
    gameEvents,
    selfSeatId: () => seatStateStore.getSnapshot().selfSeatId
  });
  lifecycle.register(shanhetu.dispose);
  const messageFilters = [
    blockEffects.filterMessage,
    skinChange.filterMessage,
    skinPaper.filterMessage,
    shanhetu.filterMessage,
    autoHg.filterMessage,
    autoBot.filterMessage
  ];
  lifecycle.register(installMicroClientMessageSource(gameEvents, window, {
    mutateMessage: (payload, className) => {
      for (const filter of messageFilters) {
        try {
          filter(payload, className);
        } catch (error) {
          console.warn('[xiaochao] 协议改写失败', className, error);
        }
      }
    },
    shouldDropProtocolEvent: (className, payload) => (
      configStore.get('block.noticeWindow') === true
      && shouldDropNoticeProtocol(className, payload, Boolean(locateGameScene(window)))
    )
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
      autoTask,
      () => blockEffects.clearRedDots(),
      shanhetu,
      updateNotice
    );
    lifecycle.register(mountedApp.unmount);
    return mountedApp;
  }
  function teardownPanel(): void {
    if (!mountedApp) return;
    mountedApp.unmount();
    mountedApp = undefined;
  }
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
  mountPlayNameProbe(window);
  return {
    mountPanelShell,
    teardownPanel,
    syncRuntimeSession() {
      blockEffects.armNoticeBlock();
    }
  };
}

const DEFAULT_PANEL_LAYOUT: XiaochaoPanelLayout = {
  top: 31,
  right: 155,
  width: '250px',
  height: readSavedPanelHeight(),
  fontFamily: 'system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Hiragino Sans GB","Noto Sans CJK SC","Noto Sans SC",Arial,sans-serif'
};

function readSavedPanelHeight(): number {
  try {
    const key = accountScopedStorageKey('XC::panelExpandedHeight');
    let raw = readBrowserSetting(key);
    if (!raw) {
      raw = readBrowserSetting('XC::panelExpandedHeight');
      if (raw) {
        writeBrowserSetting(key, raw);
        removeBrowserSetting('XC::panelExpandedHeight');
      }
    }
    const saved = Number(raw);
    // 0 表示没有保存过高度，让面板按内容自适应。
    return Number.isFinite(saved) && saved >= 160 ? Math.round(saved) : 0;
  } catch {
    return 0;
  }
}
