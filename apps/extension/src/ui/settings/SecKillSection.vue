<script setup lang="ts">
/** 秒杀连点面板：点按展开/收起，列出当前秒杀商品，单选勾选后到点自动连点抢购。 */
import { computed, onBeforeUnmount, ref, watch } from 'vue';
import type { SecKillController, SecKillItem, SecKillSnapshot } from '../../features/sec-kill/sec-kill-controller';

const props = defineProps<{
  secKillController: SecKillController;
}>();

const isOpen = ref(false);
const snapshot = ref<SecKillSnapshot>(props.secKillController.getSnapshot());
const unsubscribe = props.secKillController.subscribe((next) => {
  snapshot.value = next;
});
onBeforeUnmount(() => {
  unsubscribe();
  props.secKillController.setActive(false);
});

// 只在面板展开时拉列表，收起即停，不再常驻每秒轮询。
watch(isOpen, (open) => props.secKillController.setActive(open));

const hasItems = computed(() => snapshot.value.items.length > 0);
const selectedCount = computed(() => (
  snapshot.value.selectedActId !== null && snapshot.value.selectedGoodsId !== null ? 1 : 0
));

function toggleOpen(): void {
  isOpen.value = !isOpen.value;
}

function isChecked(item: SecKillItem): boolean {
  return snapshot.value.selectedActId === item.actId && snapshot.value.selectedGoodsId === item.goodsId;
}

function onToggle(item: SecKillItem): void {
  if (isChecked(item)) props.secKillController.cancel();
  else props.secKillController.select(item);
}
</script>

<template>
  <div class="xiaochao-seckill-entry">
    <button
      type="button"
      class="xiaochao-block-entry xiaochao-seckill-entry__trigger"
      :class="{ 'xiaochao-seckill-entry__trigger--selected': selectedCount > 0 }"
      :aria-expanded="isOpen"
      data-tooltip="开售后自动连点抢购秒杀商品，抢到或满额即停"
      @click="toggleOpen"
    >
      <span>秒杀连点</span>
      <span class="xiaochao-seckill-entry__meta">
        <span class="xiaochao-seckill-entry__state">{{ selectedCount ? '已选' : '未选' }}</span>
        <span
          class="xiaochao-seckill-entry__arrow"
          :class="{ 'xiaochao-seckill-entry__arrow--open': isOpen }"
          aria-hidden="true"
        >▾</span>
      </span>
    </button>
    <div v-show="isOpen" class="xiaochao-seckill-entry__body">
      <p v-if="!hasItems" class="xiaochao-seckill-entry__empty">当前没有可抢的秒杀商品</p>
      <label
        v-for="item in snapshot.items"
        :key="`${item.actId}:${item.goodsId}`"
        class="xiaochao-seckill-entry__item"
        :class="{ 'xiaochao-seckill-entry__item--selected': isChecked(item) }"
      >
        <input
          type="checkbox"
          :checked="isChecked(item)"
          :aria-label="item.label"
          @change="onToggle(item)"
        >
        <span class="xiaochao-seckill-entry__item-label">{{ item.label }}</span>
      </label>
    </div>
  </div>
</template>

<style scoped>
.xiaochao-seckill-entry__trigger {
  gap: 8px;
}
.xiaochao-seckill-entry__meta {
  display: flex;
  align-items: center;
  flex: 0 0 auto;
  margin-left: auto;
  gap: 6px;
}
.xiaochao-seckill-entry__state {
  padding: 1px 6px;
  border: 1px solid rgba(242, 222, 156, 0.22);
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.18);
  color: rgba(242, 222, 156, 0.72);
  font-size: 11px;
  font-weight: 400;
  letter-spacing: 0.2px;
}
.xiaochao-seckill-entry__trigger--selected .xiaochao-seckill-entry__state {
  border-color: rgba(242, 222, 156, 0.5);
  background: rgba(212, 181, 106, 0.2);
  color: #f2de9c;
}
.xiaochao-seckill-entry__arrow {
  font-size: 12px;
  line-height: 1;
  transition: transform 0.15s ease;
  transform: rotate(-90deg);
}
.xiaochao-seckill-entry__arrow--open {
  transform: rotate(0deg);
}
.xiaochao-seckill-entry__body {
  padding: 2px 4px 6px;
}
.xiaochao-seckill-entry__empty {
  margin: 0 10px 4px;
  color: rgba(242, 222, 156, 0.62);
  font-size: 12px;
}
.xiaochao-seckill-entry__item {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 10px 4px;
  padding: 5px 8px;
  border: 1px solid rgba(242, 222, 156, 0.16);
  border-radius: 6px;
  color: #f2de9c;
  font-size: 12.5px;
  cursor: pointer;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.xiaochao-seckill-entry__item:hover {
  border-color: rgba(242, 222, 156, 0.34);
}
.xiaochao-seckill-entry__item--selected {
  border-color: rgba(242, 222, 156, 0.5);
  background: rgba(212, 181, 106, 0.1);
}
.xiaochao-seckill-entry__item input {
  flex: 0 0 auto;
  accent-color: #d4b56a;
}
.xiaochao-seckill-entry__item-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
