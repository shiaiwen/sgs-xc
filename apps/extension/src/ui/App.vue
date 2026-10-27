<script setup lang="ts">
/**
 * 小抄主面板 Vue 根组件。
 *
 * 负责：面板拖拽/右停靠/折叠尺寸、Tab 切换与配置持久化、
 * 常规/山河图/工具三大页内容装配，以及重置配置对话框。
 * 业务数据全部经 props 注入的 store/controller，本组件不直接读游戏全局。
 */

import { onBeforeUnmount, onMounted, ref } from 'vue';
import { readBrowserSetting, removeBrowserSetting, writeBrowserSetting } from '../adapters/browser-settings';
import { accountScopedStorageKey } from '../features/skin-background/skin-runtime';
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
import CustomBackgroundSection from './settings/CustomBackgroundSection.vue';
// @ts-expect-error Vue 单文件由项目运行时提供。
import VersionNoticeSection from './settings/VersionNoticeSection.vue';
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
import type { AutoTaskController } from '../features/auto-task';
import type { ShanhetuController } from '../features/shanhetu';
import type { UpdateNoticeController } from '../features/update-notice';
import type { XiaochaoPanelLayout } from './mount-xiaochao-app';
import { showToast } from './toast/show-toast';
import { createElectronPlatform } from '../adapters/electron-platform';
import { createUserscriptPlatform } from '../adapters/userscript-platform';
import { constrainPanelPosition, hasExceededDragThreshold, shouldDockToRight } from './panel/panel-drag';
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
  autoTaskController: AutoTaskController | null;
  clearRedDots: () => { found: boolean; count: number };
  shanhetuController: ShanhetuController | null;
  updateNoticeController: UpdateNoticeController | null;
}>();
/** 折叠态只保留标题栏，做成状态胶囊。 */
const COLLAPSED_PANEL_HEIGHT = '34px';
const COLLAPSED_PANEL_WIDTH = '96px';
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
const isDockPreviewVisible = ref(false);
const isDockPreviewActive = ref(false);
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

onMounted(() => {
  const shell = panelElement.value;
  if (!shell) return;
  const initialHeight = resolveExpandedHeight(props.layout.height);
  setOwnedPanelLayout(shell, {
    top: `${props.layout.top}px`,
    right: `${props.layout.right}px`,
    width: props.layout.width,
    height: `${initialHeight}px`,
    maxHeight: 'none'
  });
  shell.style.fontFamily = props.layout.fontFamily;
  expandedHeight = `${initialHeight}px`;
  expandedWidth = props.layout.width;
  if (isDockedRight.value) {
    // isDockPending 初始即为 true（默认 dockedRight）；applyRightDock → reveal 就绪后揭开
    applyRightDock(shell);
    requestAnimationFrame(() => syncDockedGameLayout(shell));
    for (const delay of [320, 1200, 3000]) {
      window.setTimeout(() => syncDockedGameLayout(shell), delay);
    }
  } else restoreSavedPosition(shell);
  // 仅非停靠时保留折叠胶囊；停靠路径已在 applyRightDock 里强制展开
  if (panel.isCollapsed.value && !isDockedRight.value) applyCollapsedDimensions(shell);
  window.addEventListener('resize', keepPanelInsideViewport);
});

onBeforeUnmount(() => {
  stopDragging?.();
  stopResizing?.();
  stopUpdateNotice?.();
  clearDockRevealTimer();
  window.removeEventListener('resize', keepPanelInsideViewport);
  restoreFullGameArea();
});

function toggleCollapsed(): void {
  const shell = panelElement.value;
  if (!shell) return;
  if (!panel.isCollapsed.value) {
    // 即将折叠
    if (isDockedRight.value) {
      // 停靠下折叠：脱离贴边收成胶囊（与拖出停靠一致）；applyRightDock 已改为始终展开，不能再回灌。
      expandedWidth = getOwnedPanelLayoutValue(shell, 'width') || props.layout.width;
      const bounds = shell.getBoundingClientRect();
      isDockedRight.value = false;
      props.configStore.set('panel.dockedRight', false);
      restoreFullGameArea();
      clearDockRevealTimer();
      isDockPending.value = false;
      applyCollapsedDimensions(shell);
      panel.toggleCollapsed();
      const position = constrainPanelPosition(
        { left: window.innerWidth - shell.offsetWidth - 8, top: Math.max(8, bounds.top) },
        { width: shell.offsetWidth, height: shell.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      );
      setOwnedPanelLayout(shell, {
        left: `${position.left}px`,
        top: `${position.top}px`,
        right: 'auto'
      });
      persistFloatingPosition(shell);
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

function resetXiaochaoConfig(): void {
  try {
    props.configStore.resetAll();
    const credentialKeys = ['sgsol.rememberedCredentials.v2', 'sgsol.rememberedCredentials.v2.4399'];
    for (const key of credentialKeys) {
      window.localStorage.removeItem(key);
      window.xiaochaoStorage?.saveCredentials?.(key.endsWith('.4399') ? '4399' : 'official', []);
    }
    for (const key of Object.keys(window.sessionStorage)) {
      if (key.startsWith('XC') || key.toLowerCase().includes('xiaochao')) window.sessionStorage.removeItem(key);
    }
    showToast('小抄配置已重置，正在刷新页面', 'success', 1800);
    window.setTimeout(() => window.location.reload(), 600);
  } catch (error) {
    console.warn('[reset-xiaochao] 清除配置失败:', error);
    showToast('清除配置失败，请查看控制台', 'error', 4000);
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
  const floatingStartLeft = startedDocked ? startX - startBounds.width / 2 : startBounds.left;
  const floatingStartTop = startedDocked ? startY - 15 : startBounds.top;
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
      if (startedDocked) {
        // 先离开贴边再收成胶囊，避免折叠时又被拉回右边并套上整屏高度。
        isDockedRight.value = false;
        if (!panel.isCollapsed.value) toggleCollapsed();
        detachFromRightDock(shell, moveEvent.clientX, moveEvent.clientY);
      }
      setOwnedPanelLayout(shell, { right: 'auto' });
      shell.classList.add('xiaochao-panel--dragging');
      isDockPreviewVisible.value = true;
    }
    const position = constrainPanelPosition(
      {
        left: floatingStartLeft + deltaX,
        top: floatingStartTop + deltaY
      },
      { width: shell.offsetWidth, height: shell.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight }
    );
    setOwnedPanelLayout(shell, {
      left: `${position.left}px`,
      top: `${position.top}px`
    });
    isDockPreviewActive.value = shouldDockToRight(
      moveEvent.clientX,
      position.left + shell.offsetWidth,
      window.innerWidth
    );
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
    if (!dragStarted) return stopDragging?.();
    const bounds = shell.getBoundingClientRect();
    if (shouldDockToRight(upEvent.clientX, bounds.right, window.innerWidth)) {
      applyRightDock(shell);
    } else {
      finishAwayFromDock(shell, upEvent.clientX, upEvent.clientY);
    }
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
    isDockPreviewVisible.value = false;
    isDockPreviewActive.value = false;
    stopDragging = undefined;
  };
  const handleInterruptedDrag = () => {
    if (dragStarted) finishAwayFromDock(shell, latestMoveEvent?.clientX ?? startX, latestMoveEvent?.clientY ?? startY);
    stopDragging?.();
  };
  /** 从右侧拖开、没有再次吸附时，收成标题胶囊并停在指针附近。 */
  const finishAwayFromDock = (target: HTMLElement, pointerX: number, pointerY: number) => {
    if (startedDocked && !panel.isCollapsed.value) toggleCollapsed();
    if (startedDocked && panel.isCollapsed.value) {
      applyCollapsedDimensions(target);
      const position = constrainPanelPosition(
        { left: pointerX - target.offsetWidth / 2, top: pointerY - 15 },
        { width: target.offsetWidth, height: target.offsetHeight },
        { width: window.innerWidth, height: window.innerHeight }
      );
      setOwnedPanelLayout(target, {
        left: `${position.left}px`,
        top: `${position.top}px`
      });
    }
    persistFloatingPosition(target);
    if (panel.isCollapsed.value) applyCollapsedDimensions(target);
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

function applyRightDock(shell: HTMLElement): void {
  // 拖到右边固定：折叠态先展开，再铺满侧栏（停靠=展开侧栏，不保留胶囊贴边）。
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
  // 先写入展开宽度再 reserve，避免用折叠胶囊 rect 把游戏只让出 ~96px。
  reserveGameAreaForDockedPanel(resolveDockReserveWidth(shell));
  props.configStore.set('panel.dockedRight', true);
  // 用展开宽度再 reserve 一次，并在下一帧复同步（防同帧 rect 仍是胶囊宽）。
  syncDockedGameLayout(shell);
  scheduleDockLayoutSync(shell);
  revealDockedPanelWhenGameReady(shell);
}

function detachFromRightDock(shell: HTMLElement, pointerX: number, pointerY: number): void {
  isDockedRight.value = false;
  clearDockRevealTimer();
  isDockPending.value = false;
  const width = shell.offsetWidth;
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
  setOwnedPanelLayout(shell, {
    right: 'auto',
    left: `${Math.max(0, pointerX - width / 2)}px`,
    top: `${Math.max(0, pointerY - 15)}px`
  });
  props.configStore.set('panel.dockedRight', false);
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
    syncDockedGameLayout(shell);
  };
  if (isGameViewportReadyForDock()) {
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

/** 解析停靠应预留的宽度：展开侧栏宽度，避免布局未刷出时误用折叠胶囊的 rect。 */
function resolveDockReserveWidth(shell: HTMLElement): number {
  const owned = Number.parseFloat(getOwnedPanelLayoutValue(shell, 'width') || '');
  const expanded = Number.parseFloat(String(expandedWidth || ''));
  const rect = shell.getBoundingClientRect().width;
  // 展开侧栏通常 >= 200；折叠胶囊约 96。过渡帧优先采信 CSS 变量 / expandedWidth。
  const solid = [owned, expanded].filter((n) => Number.isFinite(n) && n >= 160);
  if (solid.length) return Math.round(Math.max(...solid));
  if (Number.isFinite(rect) && rect >= 160) return Math.round(rect);
  return Math.round(Math.max(owned || 0, expanded || 0, rect || 0, 340));
}

/** 贴在右边时按展开侧栏宽度压缩游戏区域。 */
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

function resolveExpandedHeight(savedHeight: number): number {
  const preferred = savedHeight >= 480 ? savedHeight : DEFAULT_EXPANDED_PANEL_HEIGHT;
  return Math.min(preferred, Math.max(EXPANDED_PANEL_MIN_HEIGHT, window.innerHeight - 16));
}

function rememberExpandedHeight(heightPx: number): void {
  expandedHeight = `${heightPx}px`;
  try {
    const key = accountScopedStorageKey('XC::panelExpandedHeight');
    writeBrowserSetting(key, String(Math.round(heightPx)));
  } catch {
    // 写不进本地存储时，这次会话里仍然使用刚调好的高度。
  }
}

/** 调整面板高度；限制在标题栏以下和当前窗口可见区域以内。 */
function handleResizeStart(event: PointerEvent): void {
  if (event.button !== 0 || !panelElement.value || isDockedRight.value) return;
  const shell = panelElement.value;
  const startY = event.clientY;
  const startHeight = shell.offsetHeight;
  const maximumHeight = Math.max(EXPANDED_PANEL_MIN_HEIGHT, window.innerHeight - shell.offsetTop);

  const handleMove = (moveEvent: PointerEvent) => {
    const nextHeight = Math.min(
      maximumHeight,
      Math.max(EXPANDED_PANEL_MIN_HEIGHT, startHeight + moveEvent.clientY - startY)
    );
    rememberExpandedHeight(nextHeight);
    setOwnedPanelLayout(shell, { height: expandedHeight, maxHeight: 'none' });
  };
  const handleUp = () => stopResizing?.();
  stopResizing = () => {
    window.removeEventListener('pointermove', handleMove);
    window.removeEventListener('pointerup', handleUp);
    stopResizing = undefined;
  };
  window.addEventListener('pointermove', handleMove);
  window.addEventListener('pointerup', handleUp, { once: true });
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
          <GuanxingEntry :platform="platform" />
          <CustomBackgroundSection />
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
      v-show="!isCollapsed && !isDockedRight"
      id="frame-resize-handle"
      data-tooltip="拖动调整高度"
      @pointerdown.stop="handleResizeStart"
    />
  </section>
  <div
    v-show="isDockPreviewVisible"
    class="xiaochao-dock-preview"
    :class="{ 'xiaochao-dock-preview--active': isDockPreviewActive }"
    aria-hidden="true"
  >
    <span>拖到这里固定</span>
  </div>
  <TooltipLayer />
  <BaseDialog
    :open="isResetDialogOpen"
    title="重置小抄"
    dialog-class="xiaochao-reset-dialog"
    @close="isResetDialogOpen = false"
  >
    <p>确定清除小抄配置数据吗？此操作无法撤销。</p>
    <template #footer>
      <button type="button" class="xiaochao-reset-dialog__cancel" @click="isResetDialogOpen = false">取消</button>
      <button type="button" class="xiaochao-reset-dialog__confirm" @click="resetXiaochaoConfig">清除并重载</button>
    </template>
  </BaseDialog>
</template>
