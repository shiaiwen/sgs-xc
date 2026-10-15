<script setup lang="ts">
/** 标题栏回合阶段与出杀计数展示。 */
import { onBeforeUnmount, ref } from 'vue';
import {
  formatPhase,
  formatShaRemaining,
  type TurnStatusStore
} from '../../features/turn-status/turn-status-store.ts';

const props = defineProps<{
  turnStatusStore: TurnStatusStore;
  /** 折叠标题栏：只展示剩余出杀次数。 */
  compact?: boolean;
}>();

const snapshot = ref(props.turnStatusStore.getSnapshot());
const stop = props.turnStatusStore.subscribe((next) => {
  snapshot.value = next;
});
onBeforeUnmount(stop);
</script>

<template>
  <div
    class="xc-turn-status"
    :class="{ 'xc-turn-status--compact': compact }"
    :aria-label="compact ? '剩余出杀次数' : '当前阶段与出杀次数'"
  >
    <template v-if="compact">
      <span class="xc-turn-status__item xc-turn-status__item--compact-sha" title="当前行动角色本回合剩余出杀次数">
        剩余{{ formatShaRemaining(snapshot.shaRemaining) }}
      </span>
    </template>
    <template v-else>
      <span class="xc-turn-status__item" title="当前阶段">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 22h14M5 2h14M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2" />
        </svg>
        {{ formatPhase(snapshot.phase) }}
      </span>
      <span
        class="xc-turn-status__item xc-turn-status__item--sha"
        title="当前行动角色本回合剩余出杀次数"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="m11 19-6-6M5 21l-2-2M8 16l-4 4M9.5 17.5 21 6V3h-3L6.5 14.5" />
        </svg>
        剩余：{{ formatShaRemaining(snapshot.shaRemaining) }}
      </span>
    </template>
  </div>
</template>

<style scoped>
.xc-turn-status {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex: 1 1 auto;
  min-width: 0;
  padding: 0 6px;
  font-size: 13px;
  line-height: 1.4;
  gap: 6px;
  margin: 0;
  padding: 0 2px 0 4px;
  pointer-events: none;
  color: #f2de9c;
  font-size: 11px;
  font-weight: 700;
  line-height: 1.2;
}

.xc-turn-status--compact {
  flex-direction: row;
  align-items: center;
  justify-content: flex-start;
  padding: 0 0 0 8px;
  font-size: 16px;
  line-height: 1;
  letter-spacing: 0.01em;
}

.xc-turn-status__item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  white-space: nowrap;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.xc-turn-status__item svg {
  width: 12px;
  height: 12px;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
  flex: 0 0 auto;
}

.xc-turn-status__item--sha {
  color: #f04155;
  flex: 0 0 auto;
}

.xc-turn-status__item--compact-sha {
  color: #f2de9c;
  font-size: 16px;
  font-weight: 800;
  letter-spacing: 0;
  text-shadow: 0 1px 2px rgba(0, 0, 0, .62);
}
</style>
