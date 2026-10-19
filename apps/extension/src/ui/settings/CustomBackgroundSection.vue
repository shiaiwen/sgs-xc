<script setup>
/** 其他页：上传一张图当作牌桌背景。 */
import { computed, onBeforeUnmount, ref } from 'vue';
import BaseDialog from '../dialog/BaseDialog.vue';
import { showToast } from '../toast/show-toast';
import {
  applySavedCustomBackground,
  clearSavedCustomBackground,
  getCustomBackgroundStore
} from '../../features/skin-background/custom-background-store';

const store = getCustomBackgroundStore();
const isOpen = ref(false);
const file = ref(null);
const current = ref(null);
const inputRef = ref(null);
let previewUrl = '';

const fileLabel = computed(() => file.value?.name || '未选择图片');

function showPreview(record) {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = record ? URL.createObjectURL(record.blob) : '';
  current.value = record ? { active: record.active, url: previewUrl } : null;
}

async function reload() {
  showPreview(await store.load());
}

const stop = store.subscribe(() => {
  void reload();
});
void reload();

onBeforeUnmount(() => {
  stop();
  if (previewUrl) URL.revokeObjectURL(previewUrl);
});

function openDialog() {
  isOpen.value = true;
  void reload();
}

function openPicker() {
  inputRef.value?.click();
}

function onFile(event) {
  file.value = event.currentTarget.files?.[0] ?? null;
}

function resetFile() {
  file.value = null;
  if (inputRef.value) inputRef.value.value = '';
}

async function save() {
  if (!file.value) {
    showToast('先选择一张图片', 'warning');
    return;
  }
  try {
    await applySavedCustomBackground(file.value);
    resetFile();
  } catch (error) {
    showToast(error instanceof Error ? error.message : '设置失败', 'error');
  }
}

async function clearBackground() {
  try {
    await clearSavedCustomBackground();
    showToast('已恢复原来的背景', 'success');
  } catch (error) {
    showToast(error instanceof Error ? error.message : '清除失败', 'error');
  }
}
</script>

<template>
  <button
    type="button"
    class="xiaochao-block-entry xiaochao-block-entry--center xiaochao-custom-bg-entry"
    data-tooltip="上传一张图片当作牌桌背景，只在自己屏幕上显示"
    @click="openDialog"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3 16 5-4 4 3 3-2 6 4" />
      <circle cx="9" cy="9" r="1.2" />
    </svg>
    <span>自定义背景</span>
  </button>
  <BaseDialog
    :open="isOpen"
    title="自定义背景"
    dialog-class="xiaochao-block-dialog xiaochao-custom-bg-dialog"
    @close="isOpen = false"
  >
    <div class="xiaochao-custom-bg__picker">
      <input
        ref="inputRef"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        aria-label="选择背景图"
        @change="onFile"
      >
      <button type="button" class="xiaochao-custom-bg__choose" @click="openPicker">
        选择图片
      </button>
      <span class="xiaochao-custom-bg__name" :title="fileLabel">{{ fileLabel }}</span>
    </div>
    <p class="xiaochao-custom-bg__hint">PNG、JPG、WEBP，只显示在自己的屏幕上</p>
    <button
      type="button"
      class="xiaochao-custom-bg__apply"
      :disabled="!file"
      @click="save"
    >
      设为背景
    </button>
    <div v-if="current" class="xiaochao-custom-bg__current">
      <img :src="current.url" alt="当前自定义背景">
      <div class="xiaochao-custom-bg__meta">
        <span>{{ current.active ? '正在使用这张图' : '已保存，当前让给了官方背景' }}</span>
        <button type="button" class="xiaochao-custom-bg__clear" @click="clearBackground">清除</button>
      </div>
    </div>
    <p v-else class="xiaochao-custom-bg__empty">还没有自定义背景</p>
  </BaseDialog>
</template>

<style scoped>
.xiaochao-custom-bg-entry {
  gap: 6px;
}
.xiaochao-custom-bg-entry svg {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
}
.xiaochao-custom-bg__picker {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 32px;
  padding: 3px 3px 3px 8px;
  border: 1px solid rgba(242, 222, 156, .28);
  border-radius: 4px;
  background: rgba(26, 22, 19, .72);
}
.xiaochao-custom-bg__picker input {
  position: absolute;
  width: 1px;
  height: 1px;
  margin: 0;
  opacity: 0;
  pointer-events: none;
}
.xiaochao-custom-bg__choose {
  flex: 0 0 auto;
  order: 1;
  min-height: 24px;
  padding: 0 10px;
  border: 1px solid rgba(242, 222, 156, .42);
  border-radius: 3px;
  background: rgba(57, 47, 34, .9);
  color: #f2de9c;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.xiaochao-custom-bg__choose:hover {
  border-color: rgba(242, 222, 156, .7);
  background: rgba(90, 68, 36, .95);
}
.xiaochao-custom-bg__name {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  color: #e6d6a8;
  font-size: 12px;
  line-height: 1.3;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.xiaochao-custom-bg__hint,
.xiaochao-custom-bg__empty {
  margin: 8px 0 0;
  color: rgba(214, 197, 156, .62);
  font-size: 12px;
  line-height: 1.4;
}
.xiaochao-custom-bg__apply {
  display: block;
  width: 100%;
  min-height: 30px;
  margin-top: 10px;
  border: 1px solid rgba(242, 222, 156, .55);
  border-radius: 4px;
  background: linear-gradient(180deg, #d4b56a 0%, #b8923f 100%);
  color: #2a2010;
  font: inherit;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.xiaochao-custom-bg__apply:disabled {
  border-color: rgba(242, 222, 156, .18);
  background: rgba(57, 47, 34, .55);
  color: rgba(214, 197, 156, .4);
  cursor: default;
}
.xiaochao-custom-bg__current {
  margin-top: 12px;
  overflow: hidden;
  border: 1px solid rgba(242, 222, 156, .22);
  border-radius: 4px;
  background: rgba(26, 22, 19, .45);
}
.xiaochao-custom-bg__current img {
  display: block;
  width: 100%;
  height: 96px;
  object-fit: cover;
}
.xiaochao-custom-bg__meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 6px 8px;
}
.xiaochao-custom-bg__meta span {
  color: #e6d6a8;
  font-size: 12px;
  line-height: 1.3;
}
.xiaochao-custom-bg__clear {
  flex: 0 0 auto;
  min-height: 22px;
  padding: 0 8px;
  border: 1px solid rgba(226, 120, 96, .45);
  border-radius: 3px;
  background: transparent;
  color: #e8b0a0;
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.xiaochao-custom-bg__clear:hover {
  border-color: rgba(226, 120, 96, .75);
  color: #f3d0c4;
}
</style>
