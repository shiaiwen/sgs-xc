/**
 * 面板壳 CSS 注入入口：installPanelShellStyles 写入 #xiaochao-vue-panel-shell-style。
 * 样式需兼容偏旧 Chromium（避免 :is/:has 等导致整段失效）。
 */

import { DOCK_COLLAPSED_PANEL_HEIGHT, DOCK_COLLAPSED_PANEL_WIDTH, EXPANDED_PANEL_MAX_WIDTH, EXPANDED_PANEL_MIN_WIDTH } from '../../const/panel-dock';

export const PANEL_SHELL_STYLE_ID = 'xiaochao-vue-panel-shell-style';

/** 折叠胶囊的圆角取高度一半，两头是半圆。 */
const COLLAPSED_PANEL_RADIUS = DOCK_COLLAPSED_PANEL_HEIGHT / 2;

/**
 * Vue 面板外壳的独立样式。
 *
 * 目标微端 Chromium 偏旧（约 Chrome 85 / Electron 10 一代）：
 * 不要用 :is() / :has() / inset 等新语法，否则整条规则会被丢弃，
 * 表现为打包后开关退回原生 checkbox、滑块只剩白点。
 */
const PANEL_SHELL_CSS_SOURCE = `
#xiaochao-app {
  pointer-events: none;
}
#xiaochao-dialog-host {
  position: fixed;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 2147483601;
}
#xiaochao-dialog-host > * {
  pointer-events: auto;
}
html.xiaochao-game-viewport--docked #bgDiv {
  width: var(--xc-game-viewport-width, calc(100% - var(--xc-docked-panel-width, 0px))) !important;
  max-width: var(--xc-game-viewport-width, calc(100% - var(--xc-docked-panel-width, 0px))) !important;
  box-sizing: border-box !important;
}
html.xiaochao-game-viewport--docked #layaContainer,
html.xiaochao-game-viewport--docked #laya_container,
html.xiaochao-game-viewport--docked #GameDiv {
  width: var(--xc-game-viewport-width, calc(100% - var(--xc-docked-panel-width, 0px))) !important;
  max-width: var(--xc-game-viewport-width, calc(100% - var(--xc-docked-panel-width, 0px))) !important;
  box-sizing: border-box !important;
}
#createIframe.createIframe {
  --xc-font-ui: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei UI", "Microsoft YaHei", "PingFang SC", Arial, sans-serif;
  position: fixed !important;
  left: var(--xc-panel-left, auto) !important;
  top: var(--xc-panel-top, auto) !important;
  right: var(--xc-panel-right, auto) !important;
  width: var(--xc-panel-width, ${EXPANDED_PANEL_MAX_WIDTH}px) !important;
  height: var(--xc-panel-height, 360px) !important;
  min-width: var(--xc-panel-min-width, ${EXPANDED_PANEL_MIN_WIDTH}px) !important;
  max-width: var(--xc-panel-max-width, ${EXPANDED_PANEL_MAX_WIDTH}px) !important;
  min-height: var(--xc-panel-min-height, 0px) !important;
  max-height: var(--xc-panel-max-height, none) !important;
  transform: none !important;
  z-index: 2147483600;
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  overflow: hidden;
  color: #f2de9c;
  background: rgb(35, 32, 29);
  border-radius: 8px;
  clip-path: inset(0 round 8px);
  user-select: none;
  pointer-events: auto;
  transition: box-shadow .18s ease;
}
#createIframe.createIframe.xiaochao-panel--dock-pending {
  opacity: 0 !important;
  visibility: hidden !important;
}
#createIframe.createIframe.xiaochao-panel--collapsed {
  width: ${DOCK_COLLAPSED_PANEL_WIDTH}px !important;
  min-width: ${DOCK_COLLAPSED_PANEL_WIDTH}px !important;
  max-width: ${DOCK_COLLAPSED_PANEL_WIDTH}px !important;
  height: ${DOCK_COLLAPSED_PANEL_HEIGHT}px !important;
  min-height: ${DOCK_COLLAPSED_PANEL_HEIGHT}px !important;
  max-height: ${DOCK_COLLAPSED_PANEL_HEIGHT}px !important;
}
#createIframe.xiaochao-panel--collapsed {
  border: 1px solid rgba(220, 190, 119, .42);
  border-radius: ${COLLAPSED_PANEL_RADIUS}px;
  clip-path: inset(0 round ${COLLAPSED_PANEL_RADIUS}px);
  background: linear-gradient(180deg, rgba(62, 48, 30, .96) 0%, rgba(35, 28, 21, .97) 100%);
  box-shadow: inset 0 1px 0 rgba(255, 242, 190, .12);
  transition: border-color .15s ease;
}
#createIframe.xiaochao-panel--collapsed:hover {
  border-color: rgba(242, 222, 156, .7);
}
#createIframe.xiaochao-panel--docked-right {
  border-radius: 8px 0 0 8px;
  clip-path: inset(0 round 8px 0 0 8px);
  box-shadow: -4px 0 12px rgba(0, 0, 0, .32);
}
#createIframe.xiaochao-panel--collapsed.xiaochao-panel--docked-right {
  border-right: 0;
  border-radius: ${COLLAPSED_PANEL_RADIUS}px 0 0 ${COLLAPSED_PANEL_RADIUS}px;
  clip-path: inset(0 round ${COLLAPSED_PANEL_RADIUS}px 0 0 ${COLLAPSED_PANEL_RADIUS}px);
}
#createIframe.xiaochao-panel--dragging {
  cursor: grabbing;
  opacity: .96;
}
#createIframe .xc-frame-header {
  min-height: 44px;
  margin: 0;
  display: flex;
  align-items: center;
  cursor: grab;
  touch-action: none;
  pointer-events: auto;
}
#createIframe.xiaochao-panel--collapsed .xc-frame-header {
  flex: 1 1 auto;
  min-height: 0;
  padding: 0 3px 0 8px;
}
#createIframe.xiaochao-panel--collapsed .xc-frame-toggle {
  width: 18px;
  height: 18px;
  margin: 0;
  border: 0;
  border-radius: 50%;
  background: transparent;
  color: rgba(242, 222, 156, .78);
  flex: 0 0 auto;
}
#createIframe.xiaochao-panel--collapsed .xc-frame-toggle:hover {
  background: rgba(242, 222, 156, .14);
  color: #fff1bd;
}
#createIframe.xiaochao-panel--collapsed .xc-frame-toggle__arrow {
  width: 5px;
  height: 5px;
}
#createIframe.xiaochao-panel--collapsed .xc-frame-toggle[data-collapsed="1"] .xc-frame-toggle__arrow--bottom-left {
  left: 4px;
  bottom: 4px;
}
#createIframe.xiaochao-panel--collapsed .xc-frame-toggle[data-collapsed="1"] .xc-frame-toggle__arrow--top-right {
  right: 4px;
  top: 4px;
}
#createIframe.xiaochao-panel--collapsed .xc-frame-header__status {
  margin: 0;
  align-self: stretch;
}
#createIframe .xc-frame-header__status {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  align-items: center;
  margin: 0 2px 0 0;
}
#createIframe .xiaochao-reset-toolbar {
  flex: 0 0 auto;
  margin: 0 3px 0 0;
  padding: 3px 6px;
  border: 1px solid rgba(242, 222, 156, .24);
  border-radius: 4px;
  background: rgba(54, 43, 31, .82);
  color: #c9b98f;
  font: 10px/1.2 system-ui, sans-serif;
  cursor: pointer;
  pointer-events: auto;
}
#createIframe .xiaochao-reset-toolbar:hover {
  border-color: rgba(242, 222, 156, .55);
  background: rgba(74, 58, 39, .94);
  color: #fff1bd;
}
#createIframe.xiaochao-panel--collapsed .xiaochao-reset-toolbar { display: none; }
.xiaochao-dialog.xiaochao-reset-dialog {
  width: min(360px, calc(100vw - 24px));
}
.xiaochao-dialog.xiaochao-reset-dialog .xiaochao-dialog__content {
  padding: 10px 12px 12px;
}
.xiaochao-reset-dialog__body {
  display: flex;
  flex-direction: column;
  gap: 8px;
  font-size: 11px;
  line-height: 1.45;
}
.xiaochao-reset-dialog__lead {
  margin: 0;
  color: #d2c7b3;
  font-size: 11px;
  line-height: 1.5;
}
.xiaochao-reset-dialog__list {
  margin: 0;
  padding: 0 0 0 14px;
  color: #a89888;
  font-size: 11px;
  line-height: 1.5;
}
.xiaochao-reset-dialog__list li + li {
  margin-top: 4px;
}
.xiaochao-reset-dialog__warn {
  margin: 2px 0 0;
  padding: 6px 8px;
  border: 1px solid rgba(214, 111, 87, .38);
  border-radius: 4px;
  background: rgba(105, 48, 39, .22);
  color: #e0a89a;
  font-size: 11px;
  line-height: 1.45;
}
.xiaochao-dialog.xiaochao-reset-dialog .xiaochao-dialog__footer {
  display: flex;
  justify-content: stretch;
  padding: 8px 10px;
}
.xiaochao-reset-dialog__actions {
  display: flex;
  flex: 1 1 auto;
  flex-wrap: nowrap;
  align-items: stretch;
  gap: 6px;
  width: 100%;
  min-width: 0;
}
.xiaochao-reset-dialog__actions .xiaochao-block-select-btn {
  flex: 1 1 0;
  min-width: 0;
  min-height: 26px;
  padding: 0 6px;
  font-size: 11px;
  white-space: nowrap;
}
.xiaochao-reset-dialog__confirm {
  border-color: rgba(214, 111, 87, .55) !important;
  background: linear-gradient(180deg, rgba(132, 56, 46, .92), rgba(92, 40, 34, .95)) !important;
  box-shadow: inset 0 1px rgba(255, 230, 220, .08) !important;
  color: #ffe8de !important;
}
.xiaochao-reset-dialog__confirm:hover {
  border-color: rgba(230, 130, 108, .72) !important;
  background: linear-gradient(180deg, rgba(155, 66, 54, .96), rgba(105, 48, 39, .98)) !important;
  color: #fff4ee !important;
}
#createIframe .xc-frame-toggle {
  position: relative;
  width: 26px;
  height: 26px;
  margin: 1px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 6px;
  background: transparent;
  color: #f2de9c;
  cursor: pointer;
  pointer-events: auto;
}
#createIframe .xc-frame-toggle:hover {
  color: #fff1bd;
  background: rgba(242, 222, 156, .1);
  border-color: rgba(242, 222, 156, .2);
}
#createIframe .xc-frame-toggle__icon {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  pointer-events: none;
}
#createIframe .xc-frame-toggle__arrow {
  position: absolute;
  width: 7px;
  height: 7px;
  border-top: 2px solid currentColor;
  border-right: 2px solid currentColor;
  box-sizing: border-box;
  transition: left .18s ease, right .18s ease, top .18s ease, bottom .18s ease, transform .18s ease;
}
#createIframe .xc-frame-toggle__arrow--bottom-left { left: 4px; bottom: 4px; transform: rotate(0deg); }
#createIframe .xc-frame-toggle__arrow--top-right { right: 4px; top: 4px; transform: rotate(180deg); }
#createIframe .xc-frame-toggle[data-collapsed="1"] .xc-frame-toggle__arrow--bottom-left { left: 6px; bottom: 6px; transform: rotate(180deg); }
#createIframe .xc-frame-toggle[data-collapsed="1"] .xc-frame-toggle__arrow--top-right { right: 6px; top: 6px; transform: rotate(0deg); }
#createIframe .xiaochao-panel__tabs {
  display: flex;
  flex-wrap: nowrap;
  padding: 2px;
  background: linear-gradient(180deg, #2a241f 0%, #1a1714 100%);
  box-shadow: 0 2px 6px rgba(0, 0, 0, .22);
  pointer-events: auto;
}
#createIframe .xiaochao-panel__tabs .xc-main-tab {
  flex: 1 1 0;
  min-width: 0;
  margin: 0 1px;
  padding: 3px 3px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: #a09080;
  font-size: 12px;
  line-height: 1.2;
  text-align: center;
  cursor: pointer;
}
#createIframe .xiaochao-panel__tabs .xc-main-tab:hover {
  background: rgba(55, 40, 32, .75);
  color: #f2de9c;
}
#createIframe .xiaochao-panel__tabs .xc-main-tab.active {
  border-color: rgba(242, 222, 156, .28);
  background: linear-gradient(180deg, #3d342c 0%, #2f2822 100%);
  box-shadow: inset 0 1px 0 rgba(242, 222, 156, .1);
  color: #f2de9c;
  font-weight: 700;
}
#createIframe .xiaochao-panel__tabs .xc-main-tab--update {
  position: relative;
}
#createIframe .xiaochao-panel__tabs .xc-main-tab--update::after {
  content: '';
  position: absolute;
  top: 3px;
  right: 4px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #d90000;
  box-shadow: 0 0 0 1px rgba(35, 32, 29, .85);
}
#createIframe #iframe-source { pointer-events: auto; }
#createIframe .xiaochao-panel__content {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  margin: 0;
  box-sizing: border-box;
  overflow-x: hidden;
  overflow-y: auto;
  overscroll-behavior: contain;
  scrollbar-width: none;
  background: #23201d;
  pointer-events: auto;
}
#createIframe .xiaochao-panel__content::-webkit-scrollbar { width: 0; height: 0; display: none; }
#createIframe .xiaochao-others-entry {
  flex: 1 1 auto;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  padding-top: 0;
}
#createIframe .xiaochao-others-entry .xiaochao-settings-section {
  margin: 4px 0 0;
}
#createIframe .xiaochao-others-entry__actions {
  display: flex;
  flex-direction: column;
  padding: 4px 6px 6px;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-settings-section {
  margin: 0;
}
#createIframe .xiaochao-settings-grid.xiaochao-shanhetu-switch-grid {
  grid-template-columns: 1fr 1fr;
  gap: 4px 6px;
  margin-bottom: 4px;
  padding: 4px 6px;
}
#createIframe .xiaochao-shanhetu-switch-grid > .xiaochao-block-switch {
  min-width: 0;
}
#createIframe .xiaochao-settings-grid.xiaochao-display-switch-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px 4px;
  margin-bottom: 0;
  padding: 6px 4px 8px;
}
#createIframe .xiaochao-game-assist-section {
  margin-top: 6px;
}
#createIframe .xiaochao-game-assist-section__label {
  margin: 0;
  padding: 6px 8px 2px;
  color: #c9c1b1;
  font-size: 11px;
  letter-spacing: 0.04em;
  line-height: 1.2;
}
#createIframe .xiaochao-assist-characters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 14px;
  margin: 0;
  padding: 2px 8px 8px;
}
#createIframe .xiaochao-assist-character-check {
  min-width: 0;
}
#createIframe .xiaochao-assist-character-check .xiaochao-block-check__label {
  font-size: 12px;
}
#createIframe .xiaochao-display-switch-grid > .xiaochao-block-switch {
  min-width: 0;
  pointer-events: auto;
}
#createIframe .xiaochao-display-switch-grid .xiaochao-block-switch__label {
  margin: 0 0 2px;
  text-align: center;
  font-size: 11px;
}
#createIframe .xiaochao-display-switch-grid .xiaochao-block-switch__toggle {
  margin: 0 auto;
}
#createIframe .xiaochao-shanhetu-shop-btn {
  width: calc(100% - 12px);
  margin: 2px 6px 6px;
}
#createIframe .xiaochao-shanhetu-shop-preview {
  margin: 2px 6px 4px;
  padding: 0;
  border: none;
  background: transparent;
  box-sizing: border-box;
}
#createIframe .xiaochao-shanhetu-shop-preview__title {
  margin: 0 2px 4px;
  color: #c9c1b1;
  font-size: 11px;
  letter-spacing: 0.04em;
  line-height: 1.2;
}
#createIframe .xiaochao-shanhetu-shop-preview__empty {
  margin: 0 2px 6px;
  padding: 6px 8px;
  color: #9a8f7c;
  font-size: 11px;
  line-height: 1.45;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.18);
}
/*
 * 接缝：只用 grid gap 露一次底色，禁止每格四边 border（会双线）。
 * 等级辨识：左侧色条 + 同色浅底 + 文字色（1 灰、2 蓝、3 紫、4 橙）。
 */
#createIframe .xiaochao-shanhetu-shop-preview__list {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 3px;
  width: 100%;
  margin: 0;
  padding: 0;
  box-sizing: border-box;
  background: transparent;
}
#createIframe .xiaochao-shanhetu-shop-preview__item {
  --shanhetu-shop-accent: rgba(242, 222, 156, 0.45);
  --shanhetu-shop-glow: rgba(242, 222, 156, 0.08);
  width: auto;
  min-width: 0;
  height: 24px;
  margin: 0;
  padding: 0 6px 0 8px;
  box-sizing: border-box;
  border: none;
  border-radius: 3px;
  color: #f2de9c;
  font-size: 12px;
  font-weight: 600;
  line-height: 24px;
  text-align: left;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  cursor: default;
  background:
    linear-gradient(90deg, var(--shanhetu-shop-glow) 0%, transparent 42%),
    linear-gradient(180deg, #342e27 0%, #251f1a 100%);
  box-shadow: inset 3px 0 0 var(--shanhetu-shop-accent);
}
#createIframe .xiaochao-shanhetu-shop-preview__item[data-level="1"] {
  --shanhetu-shop-accent: #b9b3a6;
  --shanhetu-shop-glow: rgba(214, 210, 200, 0.14);
  color: #e4e0d6;
}
#createIframe .xiaochao-shanhetu-shop-preview__item[data-level="2"] {
  --shanhetu-shop-accent: #5ea6ff;
  --shanhetu-shop-glow: rgba(94, 166, 255, 0.2);
  color: #9cccff;
}
#createIframe .xiaochao-shanhetu-shop-preview__item[data-level="3"] {
  --shanhetu-shop-accent: #c07cff;
  --shanhetu-shop-glow: rgba(192, 124, 255, 0.22);
  color: #d7b0ff;
}
#createIframe .xiaochao-shanhetu-shop-preview__item[data-level="4"] {
  --shanhetu-shop-accent: #ff9f2e;
  --shanhetu-shop-glow: rgba(255, 159, 46, 0.24);
  color: #ffc56d;
  text-shadow: 0 0 8px rgba(255, 159, 46, 0.28);
}
#createIframe .xc-two-column-switch-row {
  justify-content: flex-start;
  gap: 4px;
}
#createIframe .xc-two-column-switch-row > .switch-container {
  flex: 0 0 calc(50% - 2px);
  min-width: 0;
  max-width: calc(50% - 2px);
}
#createIframe .xiaochao-panel__width-handle {
  position: absolute;
  z-index: 2;
  top: 0;
  bottom: 0;
  left: 0;
  width: 6px;
  cursor: ew-resize;
  touch-action: none;
}
#createIframe .xiaochao-panel__width-handle:hover,
#createIframe .xiaochao-panel__width-handle:active {
  background: rgba(242, 222, 156, .4);
}
#createIframe #frame-resize-handle {
  position: absolute;
  z-index: 3;
  left: 0;
  right: 0;
  bottom: 0;
  height: 8px;
  pointer-events: auto;
  cursor: ns-resize;
  touch-action: none;
  background: transparent;
}
#createIframe #frame-resize-handle:hover,
#createIframe #frame-resize-handle:active {
  background: linear-gradient(
    180deg,
    transparent 0,
    rgba(242, 222, 156, .35) 100%
  );
  box-shadow: inset 0 -2px 0 rgba(242, 222, 156, .65);
}
#createIframe .xc-frame-dock-button {
  flex: 0 0 auto;
  min-height: 28px;
  margin: 0 3px;
  padding: 0 6px;
  white-space: nowrap;
  border: 1px solid #8a7650;
  border-radius: 4px;
  background: #30271c;
  color: #f2de9c;
  font: 11px/1.2 var(--xc-font-ui);
  cursor: pointer;
}
#createIframe .xc-frame-dock-button:hover {
  background: #4a3b26;
}
.xiaochao-tooltip {
  position: fixed;
  z-index: 2147483647;
  box-sizing: border-box;
  display: inline-block;
  width: max-content !important;
  max-width: min(280px, calc(100vw - 16px)) !important;
  right: auto !important;
  padding: 5px 8px;
  border: 1px solid rgba(242, 222, 156, .5);
  border-radius: 5px;
  background: rgba(29, 27, 24, .96);
  box-shadow: 0 6px 18px rgba(0, 0, 0, .3);
  color: #eee5d2;
  font: 12px/1.45 var(--xc-font-ui, system-ui, sans-serif);
  overflow-wrap: anywhere;
  white-space: pre-line;
  pointer-events: none;
  user-select: none;
  transition: none !important;
}
.xiaochao-dialog {
  position: fixed;
  top: auto;
  right: auto;
  bottom: auto;
  left: auto;
  box-sizing: border-box;
  width: min(420px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  margin: 0;
  padding: 0;
  overflow: hidden;
  border: 1px solid rgba(242, 222, 156, .45);
  border-radius: 8px;
  background: #23201d;
  box-shadow: 0 14px 42px rgba(0, 0, 0, .5);
  color: #f2de9c;
  font-family: var(--xc-font-ui, system-ui, sans-serif);
}
.xiaochao-dialog::backdrop {
  background: rgba(0, 0, 0, .48);
  backdrop-filter: blur(1px);
}
.xiaochao-dialog__header {
  display: flex;
  align-items: center;
  min-height: 38px;
  padding: 0 6px 0 12px;
  border-bottom: 1px solid rgba(242, 222, 156, .18);
  background: linear-gradient(180deg, #302923 0%, #211d19 100%);
}
.xiaochao-dialog__title {
  flex: 1;
  margin: 0;
  font-size: 14px;
  font-weight: 700;
}
.xiaochao-dialog__close {
  width: 28px;
  height: 28px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 5px;
  background: transparent;
  color: #c4b28a;
  font-size: 20px;
  line-height: 1;
  cursor: pointer;
}
.xiaochao-dialog__close:hover {
  border-color: rgba(242, 222, 156, .22);
  background: rgba(242, 222, 156, .08);
  color: #fff1bd;
}
/* 对话框定位：BaseDialog 用 JS 读取 #createIframe 的 getBoundingClientRect 后设置 fixed 位置。 */
.xiaochao-dialog-backdrop {
  position: fixed;
  z-index: 2147483601;
  background: rgba(0, 0, 0, .48);
  backdrop-filter: blur(1px);
  pointer-events: auto;
}
.xiaochao-dialog {
  pointer-events: auto;
  z-index: 2147483602;
}
.xiaochao-dialog__content {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  max-height: calc(100vh - 110px);
  padding: 12px;
  overflow-x: hidden;
  overflow-y: auto;
}
.xiaochao-dialog__footer {
  display: flex;
  justify-content: flex-end;
  padding: 8px 12px;
  border-top: 1px solid rgba(242, 222, 156, .18);
}
.xiaochao-dialog__footer > * + * {
  margin-left: 8px;
}
#createIframe .xiaochao-settings-section,
.xiaochao-dialog .xiaochao-settings-section {
  box-sizing: border-box;
  margin: 0 0 8px;
}
#createIframe [data-migrated-to-vue="true"],
#createIframe .switch-container-row[hidden] {
  display: none !important;
}
#createIframe .nav[data-xc-hide-phrase="1"] {
  display: none !important;
}
#createIframe .xiaochao-settings-section__header,
.xiaochao-dialog .xiaochao-settings-section__header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 22px;
  box-sizing: border-box;
  margin: 0 2px 3px;
  padding: 0 6px 0 7px;
  border-left: 3px solid #d7b66b;
  border-radius: 3px;
  background: linear-gradient(90deg, rgba(117, 84, 38, .32), rgba(44, 36, 28, .08) 72%, transparent);
}
#createIframe .xiaochao-settings-section__title,
.xiaochao-dialog .xiaochao-settings-section__title {
  margin: 0;
  color: #f2de9c;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: .5px;
}
#createIframe .xiaochao-settings-section__summary,
.xiaochao-dialog .xiaochao-settings-section__summary {
  color: rgba(214, 197, 156, .56);
  font-size: 10px;
  line-height: 1;
}
#createIframe .xiaochao-collapsible-header {
  width: 100%;
  border: 0;
  background: linear-gradient(90deg, rgba(117, 84, 38, .32), rgba(44, 36, 28, .08) 72%, transparent);
  color: inherit;
  font: inherit;
  cursor: pointer;
}
#createIframe .xiaochao-collapsible-header:hover {
  background: linear-gradient(90deg, rgba(117, 84, 38, .48), rgba(44, 36, 28, .14) 72%, transparent);
}
#createIframe .xiaochao-collapsible-header__arrow {
  flex: 0 0 auto;
  width: 14px;
  height: 14px;
  margin-left: 6px;
  color: #d6c59c;
  transition: transform .18s ease;
}
#createIframe .xiaochao-collapsible-header__arrow.is-open {
  transform: rotate(180deg);
}
#createIframe .xiaochao-collapsible-header__arrow svg {
  display: block;
  width: 100%;
  height: 100%;
}
#createIframe .xiaochao-settings-section__body,
.xiaochao-dialog .xiaochao-settings-section__body {
  overflow: hidden;
  border: 1px solid rgba(242, 222, 156, .16);
  border-radius: 7px;
  background:
    linear-gradient(135deg, rgba(242, 222, 156, .035), transparent 45%),
    rgba(25, 22, 19, .66);
  box-shadow: inset 0 1px rgba(255, 242, 198, .035), 0 2px 6px rgba(0, 0, 0, .14);
}
#createIframe .xiaochao-settings-grid,
.xiaochao-dialog .xiaochao-settings-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  grid-gap: 0;
  padding: 4px 8px;
}
#createIframe .xiaochao-setting-switch,
.xiaochao-dialog .xiaochao-setting-switch {
  display: flex !important;
  align-items: center !important;
  justify-content: space-between !important;
  min-width: 0;
  min-height: 28px;
  box-sizing: border-box;
  padding: 0 2px;
  border: 0;
  border-bottom: 1px solid rgba(242, 222, 156, .1);
  border-radius: 0;
  background: transparent;
  cursor: pointer;
  pointer-events: auto;
}
#createIframe .xiaochao-setting-switch:hover,
.xiaochao-dialog .xiaochao-setting-switch:hover {
  background: linear-gradient(90deg, rgba(215, 182, 107, .1), rgba(215, 182, 107, .025));
}
#createIframe .xiaochao-setting-switch:last-child,
.xiaochao-dialog .xiaochao-setting-switch:last-child { border-bottom: 0; }
#createIframe .xiaochao-setting-switch__label,
.xiaochao-dialog .xiaochao-setting-switch__label {
  flex: 1 1 auto;
  min-width: 0;
  margin-right: 5px;
  color: #d6c59c;
  font-size: 12px;
  line-height: 28px;
  white-space: nowrap;
}
#createIframe .xiaochao-setting-switch__input,
.xiaochao-dialog .xiaochao-setting-switch__input {
  position: absolute !important;
  width: 1px !important;
  height: 1px !important;
  margin: 0 !important;
  opacity: 0 !important;
  pointer-events: none !important;
}
#createIframe .xiaochao-setting-switch__track,
.xiaochao-dialog .xiaochao-setting-switch__track {
  position: relative !important;
  display: block !important;
  flex: 0 0 44px !important;
  box-sizing: border-box;
  width: 44px !important;
  height: 20px !important;
  border: 1px solid rgba(242, 222, 156, .26);
  border-radius: 999px;
  background: linear-gradient(180deg, #221e1a 0%, #1a1613 100%);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, .4);
  transition: background .2s ease, border-color .2s ease, box-shadow .2s ease;
}
#createIframe .xiaochao-setting-switch:hover .xiaochao-setting-switch__track,
.xiaochao-dialog .xiaochao-setting-switch:hover .xiaochao-setting-switch__track {
  border-color: rgba(242, 222, 156, .42);
}
#createIframe .xiaochao-setting-switch__thumb,
.xiaochao-dialog .xiaochao-setting-switch__thumb {
  position: absolute;
  top: 1px;
  left: 1px;
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: linear-gradient(180deg, #f5e6b8 0%, #dcc98a 100%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .28);
  transition: transform .2s cubic-bezier(.4, 0, .2, 1), background .2s ease;
}
#createIframe .xiaochao-setting-switch__status,
.xiaochao-dialog .xiaochao-setting-switch__status {
  position: absolute;
  top: 50%;
  right: 5px;
  transform: translateY(-50%);
  color: rgba(169, 149, 114, .92);
  font-size: 10px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: .04em;
  pointer-events: none;
}
#createIframe .xiaochao-setting-switch__input:checked + .xiaochao-setting-switch__track,
.xiaochao-dialog .xiaochao-setting-switch__input:checked + .xiaochao-setting-switch__track {
  border-color: rgba(242, 222, 156, .55);
  background: linear-gradient(180deg, #d4b56a 0%, #b8923f 100%);
  box-shadow: inset 0 1px 0 rgba(255, 248, 210, .25), 0 0 8px rgba(212, 181, 106, .18);
}
#createIframe .xiaochao-setting-switch__input:checked + .xiaochao-setting-switch__track .xiaochao-setting-switch__thumb,
.xiaochao-dialog .xiaochao-setting-switch__input:checked + .xiaochao-setting-switch__track .xiaochao-setting-switch__thumb {
  transform: translateX(24px);
  background: linear-gradient(180deg, #fffaf0 0%, #f2de9c 100%);
}
#createIframe .xiaochao-setting-switch__input:checked + .xiaochao-setting-switch__track .xiaochao-setting-switch__status,
.xiaochao-dialog .xiaochao-setting-switch__input:checked + .xiaochao-setting-switch__track .xiaochao-setting-switch__status {
  right: auto;
  left: 5px;
  color: #2a2010;
}
#createIframe .xiaochao-setting-switch__input:focus-visible + .xiaochao-setting-switch__track,
.xiaochao-dialog .xiaochao-setting-switch__input:focus-visible + .xiaochao-setting-switch__track {
  box-shadow: 0 0 0 2px rgba(242, 222, 156, .2);
}
.xiaochao-block-dialog {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
.xiaochao-auto-task-dialog {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
.xiaochao-auto-task-dialog .xiaochao-block-group__grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-gap: 8px 10px;
}
.xiaochao-auto-task-dialog .xiaochao-block-check__box {
  margin-left: 0;
}
.xiaochao-auto-task-dialog .xiaochao-auto-task-row .xiaochao-block-check__hit {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
  margin: 0;
  cursor: pointer;
}
.xiaochao-block-dialog .xiaochao-dialog__content {
  padding: 12px 10px 14px;
}
.xiaochao-auto-task-dialog .xiaochao-dialog__content {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 12px 10px 14px;
  overflow-x: hidden;
}
.xiaochao-block-select-btn {
  box-sizing: border-box;
  min-height: 24px;
  padding: 0 10px;
  border: 1px solid rgba(242, 222, 156, .42);
  border-radius: 4px;
  background: rgba(57, 47, 34, .72);
  box-shadow: inset 0 1px rgba(255, 242, 198, .04);
  color: #e6d6a8;
  font: inherit;
  font-size: 11px;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}
.xiaochao-block-select-btn:hover {
  border-color: rgba(242, 222, 156, .62);
  background: linear-gradient(90deg, rgba(215, 182, 107, .2), rgba(57, 47, 34, .78));
  color: #f2de9c;
}
.xiaochao-block-select-btn:disabled {
  opacity: .45;
  cursor: default;
}
.xiaochao-block-select-btn:active {
  border-color: rgba(242, 222, 156, .78);
  background: linear-gradient(90deg, rgba(215, 182, 107, .36), rgba(215, 182, 107, .1));
  color: #fff6d8;
}
.xiaochao-block-group {
  display: flex;
  flex-direction: column;
  margin-top: 16px;
}
.xiaochao-block-group + .xiaochao-block-group {
  margin-top: 16px;
}
.xiaochao-block-group:first-child { margin-top: 0; }
.xiaochao-block-group__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  grid-gap: 10px 4px;
}
.xiaochao-block-switch {
  box-sizing: border-box;
  min-width: 0;
}
.xiaochao-block-switch__label {
  display: block;
  margin: 0 10px 4px;
  color: #f2de9c;
  font-size: 12.5px;
  white-space: nowrap;
}
.xiaochao-block-switch__label::before,
.xiaochao-block-switch__label::after {
  content: none !important;
  display: none !important;
}
.xiaochao-block-switch__toggle {
  position: relative;
  display: block;
  width: 52px;
  height: 24px;
  margin-left: 10px;
}
.xiaochao-block-switch__toggle input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
.xiaochao-block-switch__slider {
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  border: 1px solid rgba(242, 222, 156, .26);
  border-radius: 999px;
  background: linear-gradient(180deg, #221e1a 0%, #1a1613 100%);
  box-shadow: inset 0 1px 3px rgba(0, 0, 0, .4);
  cursor: pointer;
  transition: background .2s ease, border-color .2s ease, box-shadow .2s ease;
}
.xiaochao-block-switch__slider::before {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: linear-gradient(180deg, #f5e6b8 0%, #dcc98a 100%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .45), inset 0 1px 0 rgba(255, 255, 255, .28);
  content: "";
  transition: transform .2s cubic-bezier(.4, 0, .2, 1), background .2s ease, box-shadow .2s ease;
}
.xiaochao-block-switch__toggle:hover input + .xiaochao-block-switch__slider {
  border-color: rgba(242, 222, 156, .42);
}
.xiaochao-block-switch__toggle input:checked + .xiaochao-block-switch__slider {
  border-color: rgba(242, 222, 156, .55);
  background: linear-gradient(180deg, #d4b56a 0%, #b8923f 100%);
  box-shadow: inset 0 1px 0 rgba(255, 248, 210, .25), 0 0 8px rgba(212, 181, 106, .18);
}
.xiaochao-block-switch__toggle input:checked + .xiaochao-block-switch__slider::before {
  transform: translateX(28px);
  background: linear-gradient(180deg, #fffaf0 0%, #f2de9c 100%);
  box-shadow: 0 1px 3px rgba(0, 0, 0, .3), inset 0 1px 0 rgba(255, 255, 255, .5);
}
.xiaochao-block-switch__toggle input:focus-visible + .xiaochao-block-switch__slider {
  box-shadow: 0 0 0 2px rgba(242, 222, 156, .2);
}
.xiaochao-block-switch__state {
  position: absolute;
  top: 50%;
  right: 6px;
  transform: translateY(-50%);
  color: rgba(169, 149, 114, .92);
  font-size: 11px;
  font-weight: 600;
  line-height: 1;
  letter-spacing: .04em;
  pointer-events: none;
  text-shadow: 0 1px 1px rgba(0, 0, 0, .28);
}
.xiaochao-block-switch__state::before { content: "关"; }
.xiaochao-block-switch__toggle input:checked + .xiaochao-block-switch__slider + .xiaochao-block-switch__state {
  right: auto;
  left: 6px;
  color: #2a2010;
  text-shadow: 0 1px 0 rgba(255, 248, 210, .28);
}
.xiaochao-block-switch__toggle input:checked + .xiaochao-block-switch__slider + .xiaochao-block-switch__state::before {
  content: "开";
}
.xiaochao-block-check {
  position: relative;
  display: flex;
  align-items: center;
  box-sizing: border-box;
  min-width: 0;
  min-height: 24px;
  margin: 0;
  cursor: pointer;
}
.xiaochao-dialog .xiaochao-block-check {
  font-size: 12px;
}
.xiaochao-block-check input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
.xiaochao-block-check__box {
  position: relative;
  flex: 0 0 auto;
  width: 16px;
  height: 16px;
  margin-left: 10px;
  border: 1px solid rgba(242, 222, 156, .45);
  border-radius: 3px;
  background: linear-gradient(180deg, #221e1a 0%, #1a1613 100%);
  box-shadow: inset 0 1px 2px rgba(0, 0, 0, .4);
}
.xiaochao-block-check__box::after {
  position: absolute;
  top: 1px;
  left: 4px;
  width: 5px;
  height: 9px;
  border: solid transparent;
  border-width: 0 2px 2px 0;
  content: "";
  transform: rotate(40deg);
}
.xiaochao-block-check:hover .xiaochao-block-check__box {
  border-color: rgba(242, 222, 156, .7);
}
.xiaochao-block-check input:checked + .xiaochao-block-check__box {
  border-color: rgba(242, 222, 156, .7);
  background: linear-gradient(180deg, #d4b56a 0%, #b8923f 100%);
}
.xiaochao-block-check input:checked + .xiaochao-block-check__box::after {
  border-color: #2a2010;
}
.xiaochao-block-check input:focus-visible + .xiaochao-block-check__box {
  box-shadow: 0 0 0 2px rgba(242, 222, 156, .2);
}
.xiaochao-block-check--disabled {
  opacity: .45;
  cursor: default;
}
.xiaochao-block-check__label {
  flex: 0 1 auto;
  flex-shrink: 0;
  margin-left: 6px;
  color: #f2de9c;
  font-size: 12.5px;
  line-height: 16px;
  white-space: nowrap;
}
/* 快捷工具：屏蔽/红点/皮肤/领取 两行两列紧凑入口 */
#createIframe .xiaochao-quick-tools {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin: 0 0 6px;
}
#createIframe .xiaochao-quick-tools .xiaochao-settings-section {
  margin: 0;
  min-width: 0;
}
#createIframe .xiaochao-quick-tools .xiaochao-settings-section__body {
  border: none;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
}
#createIframe .xiaochao-quick-tools .xiaochao-block-entry {
  flex-direction: column;
  justify-content: center;
  width: calc(100% - 2px);
  min-height: 34px;
  margin: 1px;
  padding: 3px 2px;
  border-radius: 4px;
  font-size: 11px;
  gap: 2px;
}
#createIframe .xiaochao-quick-tools .xiaochao-block-entry > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
#createIframe .xiaochao-quick-tools .xiaochao-block-entry__count {
  flex-shrink: 0;
  font-size: 10px;
}
/* 功能入口按钮：统一描边，避免看起来像静态文案 */
#createIframe .xiaochao-block-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: calc(100% - 8px);
  min-height: 28px;
  box-sizing: border-box;
  margin: 3px 4px;
  padding: 0 10px;
  border: 1px solid rgba(242, 222, 156, .42);
  border-radius: 5px;
  background: rgba(57, 47, 34, .72);
  box-shadow: inset 0 1px rgba(255, 242, 198, .04);
  color: #e6d6a8;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
  pointer-events: auto;
  transition: background .15s ease, border-color .15s ease, color .15s ease;
}
#createIframe .xiaochao-block-entry:hover {
  border-color: rgba(242, 222, 156, .62);
  background: linear-gradient(90deg, rgba(215, 182, 107, .2), rgba(57, 47, 34, .78));
  color: #f2de9c;
}
#createIframe .xiaochao-block-entry:active {
  border-color: rgba(242, 222, 156, .78);
  background: linear-gradient(90deg, rgba(215, 182, 107, .36), rgba(215, 182, 107, .1));
  color: #fff6d8;
}
#createIframe .xiaochao-block-entry--center {
  justify-content: center;
  text-align: center;
}
#createIframe .xiaochao-block-entry__count {
  color: rgba(214, 197, 156, .7);
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}

/* 其他页工具栏：版本状态、秒杀主操作、辅助入口、危险重置分层 */
#createIframe .xiaochao-others-entry__actions .xiaochao-version-entry {
  width: auto;
  min-height: 26px;
  box-sizing: border-box;
  margin: 0 0 4px;
  padding: 0 8px;
  border-color: transparent;
  border-bottom-color: rgba(242, 222, 156, .16);
  border-radius: 4px 4px 0 0;
  background: transparent;
  box-shadow: none;
  color: rgba(230, 214, 168, .86);
  font-size: 12px;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-version-entry:hover {
  border-color: rgba(242, 222, 156, .32);
  background: rgba(215, 182, 107, .12);
  color: #f2de9c;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-version-entry:active {
  border-color: rgba(242, 222, 156, .5);
  background: rgba(215, 182, 107, .22);
  color: #fff6d8;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-version-entry--update {
  border-color: rgba(242, 222, 156, .42);
  background: linear-gradient(180deg, rgba(215, 182, 107, .22), rgba(57, 47, 34, .7));
  color: #fff1bd;
  font-weight: 700;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-version-entry--update:hover {
  border-color: rgba(242, 222, 156, .7);
  background: linear-gradient(180deg, rgba(215, 182, 107, .34), rgba(57, 47, 34, .8));
  color: #fff6d8;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-seckill-entry {
  margin: 0 0 8px;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-seckill-entry__trigger {
  width: 100%;
  min-height: 34px;
  margin: 0;
  padding: 0 10px;
  justify-content: space-between;
  text-align: left;
  border-color: rgba(242, 222, 156, .55);
  border-radius: 6px;
  background:
    linear-gradient(180deg, rgba(215, 182, 107, .18), rgba(57, 47, 34, .82));
  box-shadow: inset 0 1px rgba(255, 242, 198, .1), 0 1px 3px rgba(0, 0, 0, .18);
  color: #f2de9c;
  font-size: 12.5px;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-seckill-entry__trigger > span:first-child {
  font-weight: 700;
  letter-spacing: .3px;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-seckill-entry__trigger:hover {
  border-color: rgba(242, 222, 156, .78);
  background:
    linear-gradient(180deg, rgba(215, 182, 107, .28), rgba(57, 47, 34, .88));
  color: #fff1bd;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-seckill-entry__trigger:active {
  border-color: rgba(242, 222, 156, .9);
  background:
    linear-gradient(180deg, rgba(215, 182, 107, .4), rgba(215, 182, 107, .12));
  color: #fff6d8;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-seckill-entry__trigger--selected {
  border-color: rgba(242, 222, 156, .72);
  background:
    linear-gradient(180deg, rgba(215, 182, 107, .26), rgba(57, 47, 34, .86));
}
#createIframe .xiaochao-others-entry__links {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  grid-gap: 5px;
  gap: 5px;
  margin: 0 0 8px;
}
#createIframe .xiaochao-others-entry__links .xiaochao-block-entry {
  width: auto;
  min-width: 0;
  min-height: 28px;
  margin: 0;
  padding: 0 8px;
  justify-content: center;
  gap: 5px;
  border-color: rgba(242, 222, 156, .28);
  background: rgba(57, 47, 34, .5);
  box-shadow: inset 0 1px rgba(255, 242, 198, .04);
  font-size: 11.5px;
}
#createIframe .xiaochao-others-entry__links .xiaochao-block-entry:hover {
  border-color: rgba(242, 222, 156, .55);
  background: linear-gradient(180deg, rgba(215, 182, 107, .18), rgba(57, 47, 34, .72));
  color: #f2de9c;
}
#createIframe .xiaochao-others-entry__links .xiaochao-block-entry:active {
  border-color: rgba(242, 222, 156, .72);
  background: linear-gradient(180deg, rgba(215, 182, 107, .3), rgba(215, 182, 107, .1));
  color: #fff6d8;
}
#createIframe .xiaochao-others-entry__links .xiaochao-block-entry svg {
  width: 13px;
  height: 13px;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}
#createIframe .xiaochao-others-entry__links .xiaochao-others-entry__link--author-tip {
  grid-column: 1 / -1;
  justify-content: center;
  gap: 6px;
  min-height: 32px;
  margin-bottom: 2px;
  border-color: rgba(215, 182, 107, .58);
  background: linear-gradient(180deg, rgba(215, 182, 107, .28), rgba(74, 58, 39, .88));
  box-shadow:
    inset 0 1px rgba(255, 242, 198, .14),
    0 1px 3px rgba(0, 0, 0, .22);
  color: #fff1c8;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.02em;
}
#createIframe .xiaochao-others-entry__links .xiaochao-others-entry__link--author-tip:hover {
  border-color: rgba(242, 222, 156, .78);
  background: linear-gradient(180deg, rgba(230, 196, 120, .38), rgba(92, 72, 48, .92));
  color: #fff6d8;
}
#createIframe .xiaochao-others-entry__links .xiaochao-others-entry__link--author-tip:active {
  border-color: rgba(242, 222, 156, .9);
  background: linear-gradient(180deg, rgba(242, 222, 156, .32), rgba(215, 182, 107, .18));
  color: #fff;
}
#createIframe .xiaochao-others-entry__links .xiaochao-others-entry__link--author-tip svg {
  width: 14px;
  height: 14px;
  fill: #e86a62;
  stroke: none;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-block-entry--danger {
  width: auto;
  min-height: 28px;
  margin: 0;
  padding: 0 10px;
  justify-content: center;
  border-color: rgba(214, 111, 87, .42);
  background: rgba(72, 36, 32, .42);
  box-shadow: none;
  color: #e8c4b6;
  font-size: 12px;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-block-entry--danger:hover {
  border-color: rgba(214, 111, 87, .72);
  background: rgba(105, 48, 39, .72);
  color: #ffe3d4;
}
#createIframe .xiaochao-others-entry__actions .xiaochao-block-entry--danger:active {
  border-color: rgba(214, 111, 87, .86);
  background: rgba(120, 52, 42, .86);
  color: #fff0e8;
}

/* 周年庆互助弹窗样式。面板快捷入口、bootstrap 装配与服务端路由仍保持关闭。 */
#createIframe .xiaochao-dialog.xiaochao-anniversary-assist-dialog,
.xiaochao-dialog.xiaochao-anniversary-assist-dialog {
  width: 100%;
  max-width: 100%;
  min-width: 0;
}
#createIframe .xiaochao-dialog.xiaochao-anniversary-assist-dialog .xiaochao-dialog__content,
.xiaochao-dialog.xiaochao-anniversary-assist-dialog .xiaochao-dialog__content {
  box-sizing: border-box;
  width: 100%;
  max-width: 100%;
  min-width: 0;
  padding: 10px 10px 12px;
  overflow-x: hidden;
}
.xiaochao-anniversary-assist {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.xiaochao-anniversary-assist__master {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid rgba(242, 222, 156, .42);
  border-radius: 6px;
  background:
    linear-gradient(180deg, rgba(215, 182, 107, .16), rgba(57, 47, 34, .82));
  box-shadow: inset 0 1px rgba(255, 242, 198, .1), 0 1px 3px rgba(0, 0, 0, .16);
  cursor: pointer;
}
.xiaochao-anniversary-assist__master-copy {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.xiaochao-anniversary-assist__master-title {
  color: #f2de9c;
  font-size: 13px;
  font-weight: 700;
  letter-spacing: .3px;
  line-height: 1.2;
}
.xiaochao-anniversary-assist__master-desc {
  color: rgba(214, 197, 156, .7);
  font-size: 10.5px;
  line-height: 1.35;
}
.xiaochao-anniversary-assist__master .xiaochao-block-switch__toggle {
  flex: 0 0 52px;
  width: 52px;
  margin: 0;
}
.xiaochao-anniversary-assist__status-card {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  box-sizing: border-box;
  padding: 8px 10px;
  border: 1px solid rgba(242, 222, 156, .22);
  border-radius: 6px;
  background: rgba(26, 21, 14, .55);
}
.xiaochao-anniversary-assist__status-card--error {
  border-color: rgba(214, 111, 87, .5);
  background: rgba(72, 36, 32, .35);
}
.xiaochao-anniversary-assist__status-card--syncing,
.xiaochao-anniversary-assist__status-card--binding,
.xiaochao-anniversary-assist__status-card--verifying {
  border-color: rgba(215, 182, 107, .55);
  background: rgba(215, 182, 107, .08);
}
.xiaochao-anniversary-assist__phase {
  flex: 0 0 auto;
  display: inline-block;
  margin: 1px 0 0;
  padding: 1px 7px;
  border: 1px solid rgba(242, 222, 156, .28);
  border-radius: 3px;
  background: rgba(215, 182, 107, .18);
  color: #f2de9c;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: .04em;
  line-height: 1.5;
}
.xiaochao-anniversary-assist__status-card--error .xiaochao-anniversary-assist__phase {
  border-color: rgba(214, 111, 87, .5);
  background: rgba(214, 111, 87, .22);
  color: #ffe3d4;
}
.xiaochao-anniversary-assist__status-body {
  min-width: 0;
  flex: 1 1 auto;
}
.xiaochao-anniversary-assist__message {
  margin: 0;
  color: #e6d6a8;
  font-size: 12px;
  line-height: 1.45;
}
.xiaochao-anniversary-assist__note {
  margin: 6px 0 0;
  color: rgba(214, 197, 156, .72);
  font-size: 10.5px;
  line-height: 1.4;
}
.xiaochao-anniversary-assist__note--inline {
  margin-top: 4px;
}
.xiaochao-anniversary-assist__stats {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  grid-gap: 6px;
  gap: 6px;
}
.xiaochao-anniversary-assist__stat {
  box-sizing: border-box;
  min-width: 0;
  padding: 7px 9px 6px;
  border: 1px solid rgba(242, 222, 156, .22);
  border-radius: 5px;
  background: rgba(57, 47, 34, .5);
  box-shadow: inset 0 1px rgba(255, 242, 198, .04);
}
.xiaochao-anniversary-assist__stat--pending {
  grid-column: 1 / -1;
  border-color: rgba(215, 182, 107, .42);
  background: rgba(215, 182, 107, .1);
}
.xiaochao-anniversary-assist__stat-label {
  display: block;
  margin-bottom: 3px;
  color: rgba(214, 197, 156, .72);
  font-size: 10px;
  letter-spacing: .2px;
}
.xiaochao-anniversary-assist__stat-value {
  color: #f2de9c;
  font-size: 15px;
  font-variant-numeric: tabular-nums;
  font-weight: 700;
  line-height: 1.2;
}
.xiaochao-anniversary-assist__section {
  display: flex;
  flex-direction: column;
}
.xiaochao-anniversary-assist__section-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 22px;
  margin: 2px 0 6px;
  padding: 0 6px 0 7px;
  border-left: 3px solid #d7b66b;
  border-radius: 3px;
  background: linear-gradient(90deg, rgba(117, 84, 38, .32), rgba(44, 36, 28, .08) 72%, transparent);
}
.xiaochao-anniversary-assist__section-title {
  margin: 0;
  color: #f2de9c;
  font-size: 12px;
  font-weight: 700;
  line-height: 1;
  letter-spacing: .5px;
}
.xiaochao-anniversary-assist__text-btn {
  flex: 0 0 auto;
  margin: 0;
  padding: 2px 6px;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: rgba(232, 196, 182, .88);
  font: inherit;
  font-size: 11px;
  cursor: pointer;
}
.xiaochao-anniversary-assist__text-btn:hover {
  border-color: rgba(214, 111, 87, .42);
  background: rgba(72, 36, 32, .4);
  color: #ffe3d4;
}
.xiaochao-anniversary-assist__text-btn:disabled {
  opacity: .45;
  cursor: default;
}
.xiaochao-anniversary-assist__credit-row {
  display: flex;
  align-items: stretch;
  grid-gap: 6px;
  gap: 6px;
  margin-top: 6px;
}
#createIframe .xiaochao-dialog .xiaochao-anniversary-assist__input,
.xiaochao-dialog .xiaochao-anniversary-assist__input {
  flex: 1 1 auto;
  min-width: 0;
  min-height: 28px;
  padding: 4px 10px;
  border: 1px solid rgba(242, 222, 156, .36);
  border-radius: 4px;
  background: rgba(26, 21, 14, .85);
  box-shadow: inset 0 1px rgba(255, 242, 198, .04);
  color: #f2de9c;
  font: inherit;
  font-size: 12px;
  appearance: none;
  -webkit-appearance: none;
}
#createIframe .xiaochao-dialog .xiaochao-anniversary-assist__input:focus,
.xiaochao-dialog .xiaochao-anniversary-assist__input:focus {
  outline: none;
  border-color: rgba(242, 222, 156, .62);
}
.xiaochao-anniversary-assist__save-btn {
  flex: 0 0 auto;
  align-self: stretch;
  min-width: 52px;
  border-color: rgba(242, 222, 156, .55);
  background: linear-gradient(180deg, rgba(215, 182, 107, .28), rgba(57, 47, 34, .85));
  color: #f2de9c;
  font-weight: 700;
}
.xiaochao-anniversary-assist__hint {
  margin: 6px 0 0;
  color: rgba(214, 197, 156, .85);
  font-size: 11px;
  line-height: 1.4;
}
.xiaochao-anniversary-assist__hint--error {
  color: #ffb3b3;
}
.xiaochao-anniversary-assist__table {
  margin: 0;
  padding: 0;
  overflow: hidden;
  list-style: none;
  border: 1px solid rgba(242, 222, 156, .18);
  border-radius: 5px;
  background: rgba(26, 21, 14, .4);
}
.xiaochao-anniversary-assist__table-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 28px;
  padding: 4px 9px;
  border-bottom: 1px solid rgba(242, 222, 156, .12);
  color: #e6d6a8;
  font-size: 11px;
}
.xiaochao-anniversary-assist__table-row:last-child {
  border-bottom: none;
}
.xiaochao-anniversary-assist__table-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.xiaochao-anniversary-assist__table-val {
  flex: 0 0 auto;
  color: #f2de9c;
  font-weight: 700;
  font-variant-numeric: tabular-nums;
}

`;

export const PANEL_SHELL_CSS = PANEL_SHELL_CSS_SOURCE;

const styleOwnerCounts = new WeakMap<Element, number>();

/** 安装一次面板样式，并返回可供生命周期注册的清理函数。 */
/** 将面板壳 CSS 注入 document；重复调用复用同一 style 节点。返回移除函数。 */
export function installPanelShellStyles(documentObject: Document = document): () => void {
  let styleElement = documentObject.getElementById(PANEL_SHELL_STYLE_ID);
  if (!styleElement) {
    styleElement = documentObject.createElement('style');
    styleElement.id = PANEL_SHELL_STYLE_ID;
    styleElement.textContent = PANEL_SHELL_CSS;
    (documentObject.head || documentObject.documentElement).appendChild(styleElement);
  } else {
    styleElement.textContent = PANEL_SHELL_CSS;
  }
  styleOwnerCounts.set(styleElement, (styleOwnerCounts.get(styleElement) || 0) + 1);
  let disposed = false;
  return () => {
    if (disposed || !styleElement) return;
    disposed = true;
    const remaining = (styleOwnerCounts.get(styleElement) || 1) - 1;
    if (remaining <= 0) {
      styleOwnerCounts.delete(styleElement);
      styleElement.remove();
      return;
    }
    styleOwnerCounts.set(styleElement, remaining);
  };
}
