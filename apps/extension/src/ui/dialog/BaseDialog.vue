<script setup lang="ts">
/** 通用对话框：定位在小抄面板区域内，不占用整个窗口。 */
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

const props = defineProps({
  open: {
    type: Boolean,
    required: true,
  },
  title: {
    type: String,
    required: true,
  },
  closeOnBackdrop: {
    type: Boolean,
    default: true,
  },
  dialogClass: {
    type: String,
    default: '',
  },
});

const emit = defineEmits(['close']);
const titleId = `xiaochao-dialog-title-${Math.random().toString(36).slice(2)}`;
let previouslyFocusedElement: Element | null = null;

const panelRect = ref<DOMRect | null>(null);

function refreshPanelRect() {
  const panel = document.querySelector<HTMLElement>('#createIframe');
  panelRect.value = panel?.getBoundingClientRect() ?? null;
}

watch(() => props.open, (open) => {
  if (open) {
    previouslyFocusedElement = document.activeElement;
    refreshPanelRect();
  } else if (previouslyFocusedElement?.isConnected) {
    (previouslyFocusedElement as HTMLElement).focus?.();
    previouslyFocusedElement = null;
  }
});

onMounted(() => {
  window.addEventListener('keydown', handleEscape);
  window.addEventListener('resize', refreshPanelRect);
});

onBeforeUnmount(() => {
  window.removeEventListener('keydown', handleEscape);
  window.removeEventListener('resize', refreshPanelRect);
});

function handleEscape(event: KeyboardEvent) {
  if (props.open && event.key === 'Escape') {
    event.preventDefault();
    requestClose();
  }
}

function requestClose() {
  emit('close');
}

function handleBackdropClick() {
  if (props.closeOnBackdrop) requestClose();
}

const backdropStyle = computed(() => {
  const rect = panelRect.value;
  if (!rect) return {};
  return {
    position: 'fixed',
    top: `${rect.top}px`,
    left: `${rect.left}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
  } as Record<string, string>;
});

const dialogStyle = computed(() => {
  const rect = panelRect.value;
  if (!rect) return {};
  return {
    position: 'fixed',
    top: `${rect.top + rect.height / 2}px`,
    left: `${rect.left + rect.width / 2}px`,
    transform: 'translate(-50%, -50%)',
    width: `min(320px, ${rect.width - 24}px)`,
    maxHeight: `${rect.height - 48}px`,
    zIndex: '2147483602',
  } as Record<string, string>;
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="xiaochao-dialog-backdrop"
      aria-hidden="true"
      :style="backdropStyle"
      @click="handleBackdropClick"
    />
    <div
      v-if="open"
      role="dialog"
      aria-modal="true"
      :class="['xiaochao-dialog', dialogClass]"
      :aria-labelledby="titleId"
      :style="dialogStyle"
    >
      <header class="xiaochao-dialog__header">
        <h2 :id="titleId" class="xiaochao-dialog__title">{{ title }}</h2>
        <button
          type="button"
          class="xiaochao-dialog__close"
          :aria-label="`关闭${title}`"
          @click="requestClose"
        >
          ×
        </button>
      </header>
      <section class="xiaochao-dialog__content">
        <slot />
      </section>
      <footer v-if="$slots.footer" class="xiaochao-dialog__footer">
        <slot name="footer" />
      </footer>
    </div>
  </Teleport>
</template>
