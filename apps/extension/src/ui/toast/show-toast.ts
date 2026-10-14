/** 统一通知入口：所有功能共用同一 Vue 通知组件和展示队列。 */

import { createApp, reactive } from 'vue';
import ToastHost from './ToastHost.vue';
import type { ToastKind, ToastNotice } from './toast-types';

export type { ToastKind } from './toast-types';

const TOAST_HOST_ID = 'xiaochao-toast-host';
const notices = reactive<ToastNotice[]>([]);
let nextId = 0;
let mountedHost: HTMLElement | null = null;

/** 屏幕顶部居中显示通知，到期自动移除。 */
export function showToast(message: string, kind: ToastKind = 'success', duration = 4000): void {
  if (typeof document === 'undefined' || !document.body) return;
  const host = ensureHost();
  if (!host) return;
  const id = ++nextId;
  notices.push({ id, message: String(message), kind });
  const timeout = Number.isFinite(duration) ? Math.max(0, duration) : 4000;
  globalThis.setTimeout(() => {
    const index = notices.findIndex((notice) => notice.id === id);
    if (index >= 0) notices.splice(index, 1);
  }, timeout);
}

function ensureHost(): HTMLElement | null {
  let host = document.getElementById(TOAST_HOST_ID);
  if (!host) {
    host = document.createElement('div');
    host.id = TOAST_HOST_ID;
    document.body.appendChild(host);
  }
  if (mountedHost !== host) {
    createApp(ToastHost, { notices }).mount(host);
    mountedHost = host;
  }
  return host;
}
