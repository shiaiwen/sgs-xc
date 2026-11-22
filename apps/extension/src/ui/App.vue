<script setup lang="ts">
/**
 * 小抄主面板 Vue 根组件。
 *
 * 负责：面板拖拽/右停靠/折叠尺寸、Tab 切换与配置持久化、
 * 常规/山河图/工具三大页内容装配，以及重置配置对话框。
 * 业务数据全部经 props 注入的 store/controller，本组件不直接读游戏全局。
 */

import { onBeforeUnmount, onMounted, ref } from 'vue';
import { DOCK_COLLAPSED_PANEL_HEIGHT, DOCK_COLLAPSED_PANEL_WIDTH, EXPANDED_PANEL_MAX_WIDTH, EXPANDED_PANEL_MIN_WIDTH, resolveDockedReserveWidth } from '../const/panel-dock';
// Vite 在构建时解析这些 Vue 单文件；类型检查缺少项目声明时会误报，这里压掉误报。
// @ts-expect-error Vue 单文件由项目运行时提供。
import PanelHeader from './panel/PanelHeader.vue';
// @ts-expect-error Vue 单文件由项目运行时提供。
import PanelTabs from './panel/PanelTabs.vue';
// @ts-expect-error Vue 单文件由项目运行时提供。
import TooltipLayer from './tooltip/TooltipLayer.vue';
// @ts-expect-error Vue 单文件由项目运行时提供。
import DisplaySettingsSection from './settings/DisplaySettingsSection.vue';
import BlockSettingsSection from './settings/BlockSettingsSection.vue';
import ClearRedDotSection from './settings/ClearRedDotSection.vue';
import GuanxingEntry from './settings/GuanxingEntry.vue';
import SkinBackgroundSettingsSection from './settings/SkinBackgroundSettingsSection.vue';
import AutoTaskSettingsSection from './settings/AutoTaskSettingsSection.vue';
import ShanhetuSettingsSection from './settings/ShanhetuSettingsSection.vue';
import GameAssistSettingsSection from './settings/GameAssistSettingsSection.vue';
// @ts-expect-error Vue 单文件由项目运行时提供。
import VersionNoticeSection from './settings/VersionNoticeSection.vue';
import AuthorTipSection from './settings/AuthorTipSection.vue';
// @ts-expect-error Vue 单文件由项目运行时提供。
import DeckRecordSection from './cards/DeckRecordSection.vue';
// @ts-expect-error Vue 单文件由项目运行时提供。
import SkillAssistSection from './cards/SkillAssistSection.vue';
// @ts-expect-error Vue 单文件由项目运行时提供。
import TurnStatusBar from './cards/TurnStatusBar.vue';
// @ts-expect-error Vue 单文件由项目运行时提供。
import BaseDialog from './dialog/BaseDialog.vue';
import {
  createXiaochaoPanelModel,
  XIAOCHAO_PANEL_TABS,
  type XiaochaoPanelTabId
} from './panel/panel-model';
import type { TurnStatusStore } from '../features/turn-status/turn-status-store';
import type { XiaochaoConfigStore } from '../config/config-store';
import type { RecentCardStore } from '../features/recent-cards/recent-card-store';
import type { GameCardCatalog } from '../features/cards/game-card-catalog';
import type { DeckRecordStore } from '../features/deck-record/deck-record-store';
import type { SkillAssistStore } from '../features/skill-assist/skill-assist-store';
import type { PeixiuRouteStore } from '../features/extra-assist/peixiu-route-store';
import type { ShanhetuController } from '../features/shanhetu';
import type { UpdateNoticeController } from '../features/update-notice';
import type { XiaochaoPanelLayout } from './mount-xiaochao-app';
import { showToast } from './toast/show-toast';
import { resetXiaochaoUserData } from '../core/reset-xiaochao-user-data';
import {
  RESET_DONE_RELOAD_DELAY_MS,
  RESET_DONE_TOAST_MS,
  RESET_ERROR_TOAST_MS,
  RESET_SERVER_FAILED_RELOAD_DELAY_MS,
  RESET_SERVER_FAILED_TOAST_MS
} from '../const/reset-xiaochao';
import { createElectronPlatform } from '../adapters/electron-platform';
import { createUserscriptPlatform } from '../adapters/userscript-platform';
import { constrainPanelPosition, FLOATING_PANEL_SAFE_MARGIN_PX, hasExceededDragThreshold, shouldSnapToRight } from './panel/panel-drag';
import {
  getOwnedPanelLayoutValue,
  setOwnedPanelLayout
} from './panel/panel-layout-ownership';
import {
  isXiaochaoDockResizeNotify,
  reserveGameAreaForDockedPanel,
  restoreFullGameArea
} from './panel/game-layout-docking';

const props = defineProps<{
  platform: 'electron' | 'userscript';
  layout: XiaochaoPanelLayout;
  configStore: XiaochaoConfigStore;
  recentCardStore: RecentCardStore;
  deckRecordStore: DeckRecordStore;
  gameCardCatalog: GameCardCatalog;
  skillAssistStore: SkillAssistStore;
  peixiuRouteStore: PeixiuRouteStore;
  turnStatusStore: TurnStatusStore;
  clearRedDots: () => { found: boolean; count: number };
  shanhetuController: ShanhetuController | null;
  updateNoticeController: UpdateNoticeController | null;
}>();
/** 折叠态只保留标题栏，做成状态胶囊。 */
const COLLAPSED_PANEL_HEIGHT = `${DOCK_COLLAPSED_PANEL_HEIGHT}px`;
const COLLAPSED_PANEL_WIDTH = `${DOCK_COLLAPSED_PANEL_WIDTH}px`;
const EXPANDED_PANEL_MIN_HEIGHT = 160;
const DEFAULT_EXPANDED_PANEL_HEIGHT = 640;
const savedTabId = props.configStore.get('panel.activeTab');
const initialTabId: XiaochaoPanelTabId = XIAOCHAO_PANEL_TABS.some((tab) => tab.id === savedTabId)
  ? savedTabId
  : 'cards';
const initialCollapsed = props.configStore.get('panel.collapsed');
const panel = createXiaochaoPanelModel(
  initialTabId,
  showTabContent,
  initialCollapsed,
  persistCollapsedState
);
// 根级 ref 直接驱动模板与标题栏，折叠切换时同步更新状态文案。
const isCollapsed = panel.isCollapsed;
const panelElement = ref<HTMLElement>();
const isDockedRight = ref(props.configStore.get('panel.dockedRight'));
/** 停靠初始化未让出游戏视口前为 true，避免首帧不透明侧栏盖住画面。 */
const isDockPending = ref(isDockedRight.value === true);
const othersHasUpdate = ref(props.updateNoticeController?.getSnapshot().hasUpdate ?? false);
const stopUpdateNotice = props.updateNoticeController?.subscribe((snapshot) => {
  othersHasUpdate.value = snapshot.hasUpdate;
});
const isResetDialogOpen = ref(false);

function openExternalPage(url: string): void {
  const adapter = props.platform === 'electron'
    ? createElectronPlatform()
    : createUserscriptPlatform();
  void adapter.openExternal(url);
}

function openXiaochaoSite(): void {
  openExternalPage('https://xc.95chong.cn/');
}

function openChangelog(): void {
  openExternalPage('https://log.95chong.cn/');
}
let expandedHeight = '';
let expandedWidth = '';
let stopDragging: (() => void) | undefined;
let stopResizing: (() => void) | undefined;
/** 侧栏已展示过则切场景不再整栏透明，避免一点击像消失。 */
let dockSidebarRevealed = false;
let toggleCollapsedLocked = false;
let collapseUnlockTimer: ReturnType<typeof setTimeout> | undefined;

onMounted(() => {
  const shell = panelElement.value;
  if (!shell) return;
  const initialHeight = resolveExpandedHeight(props.configStore.get('panel.expandedHeight'));
  const savedWidth = props.configStore.get('panel.expandedWidth');
  expandedWidth = savedWidth > 0
    ? `${Math.max(EXPANDED_PANEL_MIN_WIDTH, Math.min(savedWidth, window.innerWidth, EXPANDED_PANEL_MAX_WIDTH))}px`
    : props.layout.width;
  setOwnedPanelLayout(shell, {
    top: `${props.layout.top}px`,
    right: `${props.layout.right}px`,
    width: expandedWidth,
    height: `${initialHeight}px`,
    maxHeight: 'none'
  });
  shell.style.fontFamily = props.layout.fontFamily;
  expandedHeight = `${initialHeight}px`;
  if (isDockedRight.value) {
    applyRightDock(shell, { respectCollapsed: true });
    requestAnimationFrame(() => syncDockedGameLayout(shell));
    for (const delay of [320, 1200, 3000]) {
      window.setTimeout(() => syncDockedGameLayout(shell), delay);
    }
  } else restoreSavedPosition(shell);
  if (panel.isCollapsed.value && !isDockedRight.value) applyCollapsedDimensions(shell);
  window.addEventListener('resize', keepPanelInsideViewport);
});

onBeforeUnmount(() => {
  stopDragging?.();
  stopResizing?.();
  stopUpdateNotice?.();
  clearDockRevealTimer();
  clearCollapseUnlockTimer();
  window.removeEventListener('resize', keepPanelInsideViewport);
  restoreFullGameArea();
});

function toggleCollapsed(): void {
  if (toggleCollapsedLocked) return;
  toggleCollapsedLocked = true;
  clearCollapseUnlockTimer();
  collapseUnlockTimer = window.setTimeout(() => {
    collapseUnlockTimer = undefined;
    toggleCollapsedLocked = false;
  }, 360);
  const shell = panelElement.value;
  if (!shell) return;
  if (!panel.isCollapsed.value) {
    // 即将折叠
    if (isDockedRight.value) {
      expandedWidth = getOwnedPanelLayoutValue(shell, 'width') || props.layout.width;
      applyCollapsedDimensions(shell);
      panel.toggleCollapsed();
      isDockPending.value = false;
      clearDockRevealTimer();
      setOwnedPanelLayout(shell, {
        left: 'auto',
        right: '0px',
        top: '8px',
        height: COLLAPSED_PANEL_HEIGHT,
        minHeight: COLLAPSED_PANEL_HEIGHT,
        maxHeight: COLLAPSED_PANEL_HEIGHT,
        width: COLLAPSED_PANEL_WIDTH,
        minWidth: COLLAPSED_PANEL_WIDTH,
        maxWidth: COLLAPSED_PANEL_WIDTH
      });
      syncDockedGameLayout(shell);
      return;
    }
    const currentHeight = getOwnedPanelLayoutValue(shell, 'height') || `${shell.offsetHeight}px`;
    if (currentHeight !== '100vh') expandedHeight = currentHeight;
    expandedWidth = getOwnedPanelLayoutValue(shell, 'width') || props.layout.width;
    applyCollapsedDimensions(shell);
  } else {
    setOwnedPanelLayout(shell, {
      height: expandedHeight,
      width: expandedWidth,
      minWidth: undefined,
      maxWidth: undefined,
      minHeight: undefined,
      maxHeight: 'none'
    });
  }
  panel.toggleCollapsed();
  // 停靠状态的展开高度始终跟随游戏窗口。
  if (isDockedRight.value) applyRightDock(shell);
  else syncDockedGameLayout(shell);
}

async function resetXiaochaoConfig(): Promise<void> {
  try {
    const { serverCleared } = await resetXiaochaoUserData(props.configStore);
    if (serverCleared) {
      showToast('小抄数据已清除，正在刷新页面', 'success', RESET_DONE_TOAST_MS);
      window.setTimeout(() => window.location.reload(), RESET_DONE_RELOAD_DELAY_MS);
    } else {
      showToast('本机数据已清除，服务器上的配置没清掉，刷新后会读回来，联网后再重置一次', 'error', RESET_SERVER_FAILED_TOAST_MS);
      window.setTimeout(() => window.location.reload(), RESET_SERVER_FAILED_RELOAD_DELAY_MS);
    }
  } catch (error) {
    console.warn('[reset-xiaochao] 清除配置失败:', error);
    showToast('清除配置失败，请查看控制台', 'error', RESET_ERROR_TOAST_MS);
  } finally {
    isResetDialogOpen.value = false;
  }
}

/** 折叠态只保留标题栏，固定宽高做成状态胶囊。 */
function applyCollapsedDimensions(shell: HTMLElement): void {
  setOwnedPanelLayout(shell, {
    height: COLLAPSED_PANEL_HEIGHT,
    minHeight: COLLAPSED_PANEL_HEIGHT,
    maxHeight: COLLAPSED_PANEL_HEIGHT,
    width: COLLAPSED_PANEL_WIDTH,
    minWidth: COLLAPSED_PANEL_WIDTH,
    maxWidth: COLLAPSED_PANEL_WIDTH
  });
}

/** 保存纯 UI 状态，刷新游戏 webview 后仍恢复用户上次选择。 */
function persistCollapsedState(collapsed: boolean): void {
  props.configStore.set('panel.collapsed', collapsed);
}

/** 保存当前标签，并把内容区滚动位置复位。 */
function showTabContent(tabId: XiaochaoPanelTabId): void {
  props.configStore.set('panel.activeTab', tabId);
  const contentElement = document.getElementById('iframe-source');
  if (!contentElement) return;
  contentElement.scrollTop = 0;
}

function handleDragStart(event: PointerEvent): void {
  if (event.button !== 0 || !panelElement.value) return;
  event.preventDefault();
  const shell = panelElement.value;
  const header = event.currentTarget as HTMLElement;
  header.setPointerCapture?.(event.pointerId);
  const startedDocked = isDockedRight.value;
  const startBounds = shell.getBoundingClientRect();
  const startX = event.clientX;
  const startY = event.clientY;
  let dragStarted = false;
  let latestMoveEvent: PointerEvent | undefined;
  let animationFrameId = 0;

  const renderMove = () => {
    animationFrameId = 0;
    const moveEvent = latestMoveEvent;
    if (!moveEvent) return;
    const deltaX = moveEvent.clientX - startX;
    const deltaY = moveEvent.clientY - startY;
    if (!dragStarted && !hasExceededDragThreshold(deltaX, deltaY)) return;
    if (!dragStarted) {
      dragStarted = true;
      if (startedDocked) detachFromRightDock(shell);
      setOwnedPanelLayout(shell, { right: 'auto' });
      shell.classList.add('xiaochao-panel--dragging');
    }
    const position = constrainPanelPosition(
      {
        left: startBounds.left + deltaX,
        top: startBounds.top + deltaY
      },
      { width: shell.offsetWidth, height: shell.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setOwnedPanelLayout(shell, {
      left: `${position.left}px`,
      top: `${position.top}px`
    });
  };
  const handleMove = (moveEvent: PointerEvent) => {
    latestMoveEvent = moveEvent;
    if (!animationFrameId) animationFrameId = window.requestAnimationFrame(renderMove);
  };
  const handleUp = (upEvent: PointerEvent) => {
    if (animationFrameId) {
      window.cancelAnimationFrame(animationFrameId);
      renderMove();
    }
    if (!dragStarted) {
      if (panel.isCollapsed.value) {
        const target = upEvent.target as HTMLElement | null;
        if (!target?.closest('.xc-frame-toggle')) toggleCollapsed();
      }
      return stopDragging?.();
    }
    const bounds = shell.getBoundingClientRect();
    if (shouldSnapToRight(bounds.right, window.innerWidth)) {
      const margin = FLOATING_PANEL_SAFE_MARGIN_PX;
      const left = Math.max(margin, window.innerWidth - bounds.width - margin);
      setOwnedPanelLayout(shell, { left: `${left}px` });
    }
    persistFloatingPosition(shell);
    stopDragging?.();
  };
  stopDragging = () => {
    if (animationFrameId) window.cancelAnimationFrame(animationFrameId);
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    window.removeEventListener('pointercancel', handleInterruptedDrag);
    window.removeEventListener('blur', handleInterruptedDrag);
    header.removeEventListener('lostpointercapture', handleInterruptedDrag);
    if (header.hasPointerCapture?.(event.pointerId)) header.releasePointerCapture(event.pointerId);
    shell.classList.remove('xiaochao-panel--dragging');
    stopDragging = undefined;
  };
  const handleInterruptedDrag = () => {
    if (dragStarted) persistFloatingPosition(shell);
    stopDragging?.();
  };
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp, { once: true });
  window.addEventListener('pointercancel', handleInterruptedDrag, { once: true });
  window.addEventListener('blur', handleInterruptedDrag, { once: true });
  header.addEventListener('lostpointercapture', handleInterruptedDrag, { once: true });
}

/** 贴右前若仍是折叠胶囊，先恢复展开尺寸与状态（不走 toggle，避免与 applyRightDock 互相递归）。 */
function expandCollapsedForDock(shell: HTMLElement): void {
  if (!panel.isCollapsed.value) return;
  const height = expandedHeight || `${resolveExpandedHeight(DEFAULT_EXPANDED_PANEL_HEIGHT)}px`;
  const width = expandedWidth || props.layout.width;
  setOwnedPanelLayout(shell, {
    height,
    width,
    minWidth: undefined,
    maxWidth: undefined,
    minHeight: undefined,
    maxHeight: 'none'
  });
  expandedHeight = height;
  expandedWidth = width;
  panel.isCollapsed.value = false;
  persistCollapsedState(false);
}

function applyDockedCollapsedLayout(shell: HTMLElement): void {
  isDockedRight.value = true;
  props.configStore.set('panel.dockedRight', true);
  applyCollapsedDimensions(shell);
  setOwnedPanelLayout(shell, {
    left: 'auto',
    right: '0px',
    top: '8px',
    height: COLLAPSED_PANEL_HEIGHT,
    minHeight: COLLAPSED_PANEL_HEIGHT,
    maxHeight: COLLAPSED_PANEL_HEIGHT,
    width: COLLAPSED_PANEL_WIDTH,
    minWidth: COLLAPSED_PANEL_WIDTH,
    maxWidth: COLLAPSED_PANEL_WIDTH
  });
  isDockPending.value = false;
  syncDockedGameLayout(shell);
  revealDockedPanelWhenGameReady(shell);
}

function applyRightDock(
  shell: HTMLElement,
  options: { respectCollapsed?: boolean } = {}
): void {
  if (options.respectCollapsed && panel.isCollapsed.value) {
    applyDockedCollapsedLayout(shell);
    return;
  }
  // 手动拖到右边时仍展开侧栏；不把折叠胶囊拉成整栏高度。
  expandCollapsedForDock(shell);
  isDockedRight.value = true;
  setOwnedPanelLayout(shell, {
    left: 'auto',
    right: '0px',
    top: '0px',
    width: expandedWidth,
    height: '100vh',
    minWidth: undefined,
    maxWidth: undefined,
    minHeight: undefined,
    maxHeight: undefined
  });
  reserveGameAreaForDockedPanel(resolveDockReserveWidth(shell));
  props.configStore.set('panel.dockedRight', true);
  syncDockedGameLayout(shell);
  scheduleDockLayoutSync(shell);
  revealDockedPanelWhenGameReady(shell);
}

function detachFromRightDock(shell: HTMLElement): void {
  isDockedRight.value = false;
  clearDockRevealTimer();
  isDockPending.value = false;
  // 必须先归还游戏宽度，再把面板切回悬浮坐标。
  restoreFullGameArea();
  if (panel.isCollapsed.value) applyCollapsedDimensions(shell);
  else {
    const savedHeight = Number.parseFloat(expandedHeight) || 0;
    const height = Math.min(savedHeight > 0 ? savedHeight : 320, window.innerHeight);
    setOwnedPanelLayout(shell, {
      width: expandedWidth,
      height: `${height}px`,
      maxHeight: 'none'
    });
  }
  props.configStore.set('panel.dockedRight', false);
}

function toggleRightDock(): void {
  const shell = panelElement.value;
  if (!shell) return;
  if (!isDockedRight.value) {
    persistFloatingPosition(shell);
    applyRightDock(shell);
    return;
  }
  detachFromRightDock(shell);
  restoreSavedPosition(shell);
  keepPanelInsideViewport();
  persistFloatingPosition(shell);
}

function persistFloatingPosition(shell: HTMLElement): void {
  const floatingPosition = { left: shell.offsetLeft, top: shell.offsetTop };
  isDockedRight.value = false;
  props.configStore.set('panel.dockedRight', false);
  restoreFullGameArea();
  setOwnedPanelLayout(shell, {
    left: `${floatingPosition.left}px`,
    top: `${floatingPosition.top}px`,
    right: 'auto'
  });
  props.configStore.set('panel.position', floatingPosition);
}

function restoreSavedPosition(shell: HTMLElement): void {
  const saved = props.configStore.get('panel.position');
  if (!saved) return;
  const position = constrainPanelPosition(saved, {
    width: shell.offsetWidth,
    height: shell.offsetHeight
  }, {
    width: window.innerWidth,
    height: window.innerHeight
  });
  setOwnedPanelLayout(shell, { left: `${position.left}px`, top: `${position.top}px`, right: 'auto' });
}

function keepPanelInsideViewport(): void {
  const shell = panelElement.value;
  if (!shell) return;
  if (isDockedRight.value) {
    if (isXiaochaoDockResizeNotify()) return;
    syncDockedGameLayout(shell);
    return;
  }
  if (panel.isCollapsed.value) applyCollapsedDimensions(shell);
  const bounds = shell.getBoundingClientRect();
  const position = constrainPanelPosition(bounds, bounds, {
    width: window.innerWidth,
    height: window.innerHeight
  });
  setOwnedPanelLayout(shell, { left: `${position.left}px`, top: `${position.top}px`, right: 'auto' });
}

/** 停靠初始化：游戏 bgDiv/Laya 未就绪时先隐藏侧栏，就绪或超时后再显示，避免遮盖游戏。 */
let dockRevealTimer: ReturnType<typeof setInterval> | undefined;
function clearCollapseUnlockTimer(): void {
  if (collapseUnlockTimer !== undefined) {
    window.clearTimeout(collapseUnlockTimer);
    collapseUnlockTimer = undefined;
  }
}
function clearDockRevealTimer(): void {
  if (dockRevealTimer !== undefined) {
    clearInterval(dockRevealTimer);
    dockRevealTimer = undefined;
  }
}
function isGameViewportReadyForDock(): boolean {
  const layaReady = Boolean((window as any).Laya?.Browser);
  const bg = document.getElementById('bgDiv');
  return layaReady || Boolean(bg);
}
function revealDockedPanelWhenGameReady(shell: HTMLElement): void {
  clearDockRevealTimer();
  if (!isDockedRight.value) {
    isDockPending.value = false;
    return;
  }
  const reveal = () => {
    isDockPending.value = false;
    dockSidebarRevealed = true;
    syncDockedGameLayout(shell);
  };
  if (dockSidebarRevealed || isGameViewportReadyForDock()) {
    reveal();
    return;
  }
  isDockPending.value = true;
  let attempts = 0;
  dockRevealTimer = setInterval(() => {
    attempts += 1;
    if (!isDockedRight.value) {
      clearDockRevealTimer();
      isDockPending.value = false;
      return;
    }
    if (isGameViewportReadyForDock() || attempts >= 15) {
      // ~3s@200ms：尽快显示；就绪则同步视口后再露出来
      clearDockRevealTimer();
      reveal();
    }
  }, 200);
}

/** 停靠且已折叠时让出折叠宽度。贴边展开时才用展开宽度。 */
function resolveDockReserveWidth(shell: HTMLElement): number {
  const owned = Number.parseFloat(getOwnedPanelLayoutValue(shell, 'width') || '');
  const expanded = Number.parseFloat(String(expandedWidth || ''));
  const rect = shell.getBoundingClientRect().width;
  return resolveDockedReserveWidth({
    collapsed: panel.isCollapsed.value,
    ownedWidth: owned,
    expandedWidth: expanded,
    rectWidth: rect
  });
}

/** 贴在右边时按当前侧栏宽度压缩游戏区域。 */
function syncDockedGameLayout(shell: HTMLElement): void {
  if (isDockedRight.value) {
    reserveGameAreaForDockedPanel(resolveDockReserveWidth(shell));
  } else {
    restoreFullGameArea();
  }
}

/** 布局写入后再同步一次，避免同帧 rect 仍是折叠宽度。 */
function scheduleDockLayoutSync(shell: HTMLElement): void {
  requestAnimationFrame(() => {
    if (!isDockedRight.value) return;
    syncDockedGameLayout(shell);
    requestAnimationFrame(() => {
      if (isDockedRight.value) syncDockedGameLayout(shell);
    });
  });
}

/** 没调过高度时用默认高度。窗口比上次调的矮时收进窗口里。 */
function resolveExpandedHeight(savedHeight: number): number {
  const preferred = savedHeight >= EXPANDED_PANEL_MIN_HEIGHT ? savedHeight : DEFAULT_EXPANDED_PANEL_HEIGHT;
  return Math.min(preferred, Math.max(EXPANDED_PANEL_MIN_HEIGHT, window.innerHeight - 16));
}

/** 调整面板高度；限制在标题栏以下和当前窗口可见区域以内。 */
function handleWidthResizeStart(event: PointerEvent): void {
  const shell = panelElement.value;
  if (event.button !== 0 || !shell || panel.isCollapsed.value) return;
  event.preventDefault();
  stopResizing?.();
  const handle = event.currentTarget as HTMLElement;
  const pointerId = event.pointerId;
  handle.setPointerCapture(pointerId);
  const start = shell.getBoundingClientRect();
  const startX = event.clientX;
  const docked = isDockedRight.value;
  const right = Math.max(EXPANDED_PANEL_MIN_WIDTH, Math.min(start.right, window.innerWidth));
  const availableWidth = docked ? Math.max(EXPANDED_PANEL_MIN_WIDTH, window.innerWidth - 320) : right;
  const maximumWidth = Math.min(EXPANDED_PANEL_MAX_WIDTH, availableWidth);
  let width: number | undefined;

  const move = (next: PointerEvent) => {
    if (next.pointerId !== pointerId) return;
    width = Math.round(Math.min(maximumWidth, Math.max(EXPANDED_PANEL_MIN_WIDTH, start.width + startX - next.clientX)));
    expandedWidth = `${width}px`;
    setOwnedPanelLayout(shell, docked
      ? { width: expandedWidth }
      : { width: expandedWidth, left: `${right - width}px`, right: 'auto' });
    if (docked) syncDockedGameLayout(shell);
  };
  const finish = (next: PointerEvent) => {
    if (next.pointerId === pointerId) stopResizing?.();
  };
  stopResizing = () => {
    handle.removeEventListener('pointermove', move);
    handle.removeEventListener('lostpointercapture', finish);
    stopResizing = undefined;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    if (width === undefined) return;
    props.configStore.set('panel.expandedWidth', width);
    if (!docked) persistFloatingPosition(shell);
  };
  handle.addEventListener('pointermove', move);
  handle.addEventListener('lostpointercapture', finish);
}

function handleResizeStart(event: PointerEvent): void {
  if (event.button !== 0 || !panelElement.value || isDockedRight.value || panel.isCollapsed.value) return;
  event.preventDefault();
  stopResizing?.();
  const shell = panelElement.value;
  const handle = event.currentTarget as HTMLElement;
  const pointerId = event.pointerId;
  handle.setPointerCapture(pointerId);
  const startY = event.clientY;
  const startHeight = shell.offsetHeight;
  const maximumHeight = Math.max(EXPANDED_PANEL_MIN_HEIGHT, window.innerHeight - shell.offsetTop);
  let resizedHeight: number | undefined;

  const handleMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    if ((moveEvent.buttons & 1) === 0) {
      stopResizing?.();
      return;
    }
    resizedHeight = Math.min(
      maximumHeight,
      Math.max(EXPANDED_PANEL_MIN_HEIGHT, startHeight + moveEvent.clientY - startY)
    );
    expandedHeight = `${resizedHeight}px`;
    setOwnedPanelLayout(shell, { height: expandedHeight, maxHeight: 'none' });
  };
  const finish = () => stopResizing?.();
  const handlePointerEnd = (endEvent: PointerEvent) => {
    if (endEvent.pointerId === pointerId) finish();
  };
  const handleKeyDown = (keyEvent: KeyboardEvent) => {
    if (keyEvent.key !== 'Escape') return;
    expandedHeight = `${startHeight}px`;
    setOwnedPanelLayout(shell, { height: expandedHeight, maxHeight: 'none' });
    resizedHeight = undefined;
    finish();
  };
  stopResizing = () => {
    handle.removeEventListener('pointermove', handleMove);
    handle.removeEventListener('pointerup', handlePointerEnd);
    handle.removeEventListener('pointercancel', handlePointerEnd);
    handle.removeEventListener('lostpointercapture', handlePointerEnd);
    window.removeEventListener('blur', finish);
    window.removeEventListener('keydown', handleKeyDown, true);
    stopResizing = undefined;
    if (handle.hasPointerCapture(pointerId)) handle.releasePointerCapture(pointerId);
    // 松手才存，拖的时候每动一下都写一遍整份配置会卡。
    if (resizedHeight !== undefined) props.configStore.set('panel.expandedHeight', Math.round(resizedHeight));
  };
  handle.addEventListener('pointermove', handleMove);
  handle.addEventListener('pointerup', handlePointerEnd);
  handle.addEventListener('pointercancel', handlePointerEnd);
  handle.addEventListener('lostpointercapture', handlePointerEnd);
  window.addEventListener('blur', finish);
  window.addEventListener('keydown', handleKeyDown, true);
}
</script>

<template>
  <section
    ref="panelElement"
    id="createIframe"
    class="createIframe xiaochao-panel"
    :class="{
      'xiaochao-panel--collapsed': isCollapsed,
      'xiaochao-panel--docked-right': isDockedRight,
      'xiaochao-panel--dock-pending': isDockPending
    }"
    aria-label="三国杀小抄"
  >
    <PanelHeader
      :collapsed="isCollapsed"
      @toggle="toggleCollapsed"
      :docked-right="isDockedRight"
      @toggle-dock="toggleRightDock"
      @drag-start="handleDragStart"
    >
      <TurnStatusBar
        :turn-status-store="turnStatusStore"
        :compact="isCollapsed"
      />
    </PanelHeader>
    <PanelTabs
      v-show="!isCollapsed"
      :active-tab-id="panel.activeTabId.value"
      :others-has-update="othersHasUpdate"
      @select="panel.selectTab"
    />
    <main
      v-show="!isCollapsed && panel.activeTabId.value === 'cards'"
      class="xiaochao-panel__content xiaochao-cards-pane"
    >
      <SkillAssistSection
        :skill-assist-store="skillAssistStore"
        :game-card-catalog="gameCardCatalog"
      />
      <DeckRecordSection
        :config-store="configStore"
        :deck-record-store="deckRecordStore"
        :game-card-catalog="gameCardCatalog"
      />
      <SkillAssistSection
        solo-panel-id="yuqi"
        :skill-assist-store="skillAssistStore"
        :game-card-catalog="gameCardCatalog"
      />
      <DisplaySettingsSection :config-store="configStore" />
      <GameAssistSettingsSection :config-store="configStore" />
      <div class="xiaochao-quick-tools" aria-label="快捷工具">
        <BlockSettingsSection :config-store="configStore" />
        <SkinBackgroundSettingsSection :config-store="configStore" />
        <AutoTaskSettingsSection :config-store="configStore" />
        <ClearRedDotSection :clear-red-dots="clearRedDots" />
      </div>
    </main>
    <main
      v-show="!isCollapsed && panel.activeTabId.value === 'others'"
      class="xiaochao-panel__content xiaochao-others-entry"
    >
      <ShanhetuSettingsSection
        :config-store="configStore"
        :open-shop="() => shanhetuController?.openShop() ?? false"
        :get-shop-preview="() => shanhetuController?.getShopPreview() ?? []"
        :subscribe-shop-preview="(listener) => shanhetuController?.subscribeShopPreview(listener) ?? (() => {})"
      />
      <section class="xiaochao-settings-section" aria-label="工具栏">
        <div class="xiaochao-settings-section__body xiaochao-others-entry__actions">
          <VersionNoticeSection :update-notice-controller="updateNoticeController" />
          <AuthorTipSection />
          <GuanxingEntry :platform="platform" />
          <button
            type="button"
            class="xiaochao-block-entry xiaochao-block-entry--center"
            data-tooltip="在浏览器新页面打开小抄主页"
            @click="openXiaochaoSite"
          >
            <span>小抄主页</span>
          </button>
          <button
            type="button"
            class="xiaochao-block-entry xiaochao-block-entry--center"
            data-tooltip="在浏览器新页面打开更新日志"
            @click="openChangelog"
          >
            <span>更新日志</span>
          </button>
          <button
            type="button"
            class="xiaochao-block-entry xiaochao-block-entry--center"
            data-tooltip="清除小抄配置和授权缓存"
            @click="isResetDialogOpen = true"
          >
            <span>重置小抄</span>
          </button>
        </div>
      </section>
    </main>
    <main
      id="iframe-source"
      class="xiaochao-panel__content"
      :style="{ display: isCollapsed || panel.activeTabId.value === 'cards' || panel.activeTabId.value === 'others' ? 'none' : '' }"
    />
    <div
      v-show="!isCollapsed"
      class="xiaochao-panel__width-handle"
      title="拖动调整面板宽度"
      @pointerdown.stop="handleWidthResizeStart"
    />
    <div
      v-show="!isCollapsed && !isDockedRight"
      id="frame-resize-handle"
      data-tooltip="拖动调整高度"
      @pointerdown.stop="handleResizeStart"
    />
  </section>
  <TooltipLayer />
  <BaseDialog
    :open="isResetDialogOpen"
    title="重置小抄"
    dialog-class="xiaochao-reset-dialog"
    @close="isResetDialogOpen = false"
  >
    <p>将清除小抄的开关、皮肤与背景、上传的背景图片和视频、记住的登录账号等。当前游戏账号的开关、皮肤和背景选择存在服务器上，微端和浏览器共用，会一起清掉；上传的图片视频和记住的登录账号只清这台设备上的。无法撤销。</p>
    <template #footer>
      <button type="button" class="xiaochao-reset-dialog__cancel" @click="isResetDialogOpen = false">取消</button>
      <button type="button" class="xiaochao-reset-dialog__confirm" @click="resetXiaochaoConfig">清除并重载</button>
    </template>
  </BaseDialog>
</template>
