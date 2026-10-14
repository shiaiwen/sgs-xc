<script setup lang="ts">
import type { ToastNotice } from './toast-types';

defineProps<{ notices: readonly ToastNotice[] }>();
</script>

<template>
  <TransitionGroup
    name="xc-notify"
    tag="div"
    class="xc-notify-stack"
    role="region"
    aria-label="小抄通知"
    aria-live="polite"
  >
    <div
      v-for="notice in notices"
      :key="notice.id"
      class="xc-notify"
      :class="`xc-notify--${notice.kind}`"
      role="status"
    >
      <span class="xc-notify__icon" aria-hidden="true">!</span>
      <span class="xc-notify__message">{{ notice.message }}</span>
    </div>
  </TransitionGroup>
</template>

<style>
.xc-notify-stack {
  position: fixed;
  z-index: 2147483647;
  top: 64px;
  left: 50%;
  display: flex;
  width: max-content;
  max-width: calc(100vw - 32px);
  flex-direction: column;
  align-items: center;
  gap: 8px;
  transform: translateX(-50%);
  pointer-events: none;
}

.xc-notify {
  display: flex;
  max-width: 100%;
  align-items: center;
  gap: 9px;
  box-sizing: border-box;
  padding: 9px 15px;
  border: 1px solid rgba(242, 222, 156, .36);
  border-radius: 7px;
  background: rgba(29, 27, 24, .96);
  box-shadow: 0 6px 20px rgba(0, 0, 0, .38);
  color: #f3ead2;
  font: 13px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Microsoft YaHei", sans-serif;
  text-align: left;
}

.xc-notify--success { --xc-notify-accent: #a9d49a; }
.xc-notify--warning { --xc-notify-accent: #f2d27a; }
.xc-notify--error { --xc-notify-accent: #f08a7a; }

.xc-notify__icon {
  display: inline-flex;
  width: 19px;
  height: 19px;
  flex: 0 0 19px;
  align-items: center;
  justify-content: center;
  box-sizing: border-box;
  border: 1.5px solid var(--xc-notify-accent, #f2d27a);
  border-radius: 50%;
  color: var(--xc-notify-accent, #f2d27a);
  font: 700 13px/1 system-ui, sans-serif;
}

.xc-notify__message {
  overflow-wrap: anywhere;
}

.xc-notify-enter-active,
.xc-notify-leave-active,
.xc-notify-move {
  transition: opacity .18s ease, transform .18s ease;
}

.xc-notify-enter-from,
.xc-notify-leave-to {
  opacity: 0;
  transform: translateY(-7px);
}

.xc-notify-leave-active {
  position: absolute;
}
</style>
