<script setup lang="ts">
/** 版本更新入口：和工具栏按钮同一格式，图标负责检查并打开更新页。 */
import { computed, onBeforeUnmount, ref } from 'vue';
import type { UpdateNoticeController, UpdateNoticeSnapshot } from '../../features/update-notice';
import { getXiaochaoVersion, XIAOCHAO_UPDATE_PAGE_URL } from '../../features/update-notice';

const props = defineProps<{
  updateNoticeController: UpdateNoticeController | null;
}>();

const snapshot = ref<UpdateNoticeSnapshot>(
  props.updateNoticeController?.getSnapshot() ?? {
    currentVersion: getXiaochaoVersion(),
    latestVersion: null,
    notes: '',
    pageUrl: XIAOCHAO_UPDATE_PAGE_URL,
    hasUpdate: false,
    dialogOpen: false,
    failureMessage: ''
  }
);

const checking = ref(false);
const hint = ref('');

const unsubscribe = props.updateNoticeController?.subscribe((next) => {
  snapshot.value = next;
});

onBeforeUnmount(() => unsubscribe?.());

const label = computed(() => {
  if (checking.value) return '正在检查';
  if (snapshot.value.hasUpdate) return '去更新';
  return hint.value || `小抄 ${snapshot.value.currentVersion}`;
});

const tooltip = computed(() => {
  if (snapshot.value.hasUpdate && snapshot.value.latestVersion) {
    return `线上 ${snapshot.value.latestVersion}，打开更新页`;
  }
  if (snapshot.value.latestVersion) return `线上 ${snapshot.value.latestVersion}`;
  return '检查门户上的版本';
});

function openPage(): void {
  void props.updateNoticeController?.openUpdatePage();
}

async function onVersionClick(): Promise<void> {
  if (snapshot.value.hasUpdate) {
    openPage();
    return;
  }
  if (checking.value) return;
  checking.value = true;
  hint.value = '';
  try {
    const next = await props.updateNoticeController?.checkNow();
    if (!next || next.hasUpdate) return;
    hint.value = next.latestVersion ? '已是最新' : (next.failureMessage || '检查失败');
  } finally {
    checking.value = false;
  }
}
</script>

<template>
  <button
    type="button"
    class="xiaochao-block-entry xiaochao-block-entry--center xiaochao-version-entry"
    :data-tooltip="tooltip"
    @click="onVersionClick"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        v-if="snapshot.hasUpdate"
        d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14"
      />
      <path
        v-else
        d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-6.36-2.64L3 16m0 0h5m-5 0v5M3 12a9 9 0 0 1 9-9 9 9 0 0 1 6.36 2.64L21 8m0 0h-5m5 0V3"
      />
    </svg>
    <span>{{ label }}</span>
  </button>
</template>

<style scoped>
.xiaochao-version-entry {
  gap: 6px;
}
.xiaochao-version-entry svg {
  width: 14px;
  height: 14px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex: 0 0 auto;
}
</style>
