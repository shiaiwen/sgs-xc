<script setup>
/** 游戏辅助开关：进阶辅助、自动托管、自动换将、百胜、酒馆目标。 */
import { computed, onBeforeUnmount, reactive, ref } from 'vue';
import {
  EXTRA_ASSIST_CHARACTER_SETTINGS,
  EXTRA_ASSIST_ENABLED_KEY,
  GAME_ASSIST_SWITCH_SETTINGS,
} from '../../features/extra-assist/extra-assist-settings';

const props = defineProps({
  configStore: {
    type: Object,
    required: true,
  },
});

const values = reactive(Object.fromEntries(
  [...GAME_ASSIST_SWITCH_SETTINGS, ...EXTRA_ASSIST_CHARACTER_SETTINGS].map(({ key }) => [key, props.configStore.get(key)])
));
const hoverKey = ref('');
const hoverTip = computed(() => (
  [...GAME_ASSIST_SWITCH_SETTINGS, ...EXTRA_ASSIST_CHARACTER_SETTINGS]
    .find((setting) => setting.key === hoverKey.value)?.tooltip || ''
));

const unsubscribe = [
  ...[...GAME_ASSIST_SWITCH_SETTINGS, ...EXTRA_ASSIST_CHARACTER_SETTINGS].map(({ key }) => (
    props.configStore.subscribe(key, ({ value }) => {
      values[key] = value;
    })
  )),
];

onBeforeUnmount(() => unsubscribe.forEach((stop) => stop()));

function updateSetting(key, event) {
  props.configStore.set(key, event.currentTarget.checked);
}

</script>

<template>
  <section class="xiaochao-settings-section" aria-label="辅助功能">
    <div class="xiaochao-settings-section__body">
      <div class="xiaochao-settings-grid xiaochao-display-switch-grid">
        <div
          v-for="setting in GAME_ASSIST_SWITCH_SETTINGS"
          :key="setting.key"
          class="xiaochao-block-switch xiaochao-game-assist-switch"
          :data-tooltip="setting.tooltip"
          @mouseenter="hoverKey = setting.key"
          @mouseleave="hoverKey = ''"
        >
          <span class="xiaochao-block-switch__label">
            {{ setting.label }}
          </span>
          <label
            class="xiaochao-block-switch__toggle"
            :data-tooltip="setting.tooltip"
            :title="setting.tooltip"
          >
            <input
              type="checkbox"
              :aria-label="setting.label"
              :checked="values[setting.key]"
              @change="updateSetting(setting.key, $event)"
            >
            <span class="xiaochao-block-switch__slider" />
            <span class="xiaochao-block-switch__state" aria-hidden="true" />
          </label>
        </div>
      </div>
      <div
        v-if="values[EXTRA_ASSIST_ENABLED_KEY]"
        class="xiaochao-assist-characters"
      >
        <div
          v-for="setting in EXTRA_ASSIST_CHARACTER_SETTINGS"
          :key="setting.key"
          class="xiaochao-block-switch xiaochao-game-assist-switch xiaochao-assist-character"
          :data-tooltip="setting.tooltip"
          @mouseenter="hoverKey = setting.key"
          @mouseleave="hoverKey = ''"
        >
          <span class="xiaochao-block-switch__label">{{ setting.label }}</span>
          <label class="xiaochao-block-switch__toggle" :data-tooltip="setting.tooltip" :title="setting.tooltip">
            <input
              type="checkbox"
              :aria-label="setting.label"
              :checked="values[setting.key]"
              @change="updateSetting(setting.key, $event)"
            >
            <span class="xiaochao-block-switch__slider" />
            <span class="xiaochao-block-switch__state" aria-hidden="true" />
          </label>
        </div>
      </div>
      <p v-if="hoverTip" class="xiaochao-game-assist-tip">{{ hoverTip }}</p>
    </div>
  </section>
</template>

<style scoped>
.xiaochao-game-assist-switch {
  position: relative;
  pointer-events: auto;
}

.xiaochao-assist-characters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 6px 8px 10px 18px;
}

.xiaochao-assist-character {
  min-width: 0;
}

.xiaochao-assist-character :deep(.xiaochao-block-switch__label) {
  margin: 0 0 3px;
  font-size: 11px;
}

.xiaochao-assist-character :deep(.xiaochao-block-switch__toggle) {
  width: 36px;
  height: 16px;
  margin-left: 0;
}

.xiaochao-assist-character :deep(.xiaochao-block-switch__slider::before) {
  top: 1px;
  left: 1px;
  width: 12px;
  height: 12px;
}

.xiaochao-assist-character :deep(.xiaochao-block-switch__toggle input:checked + .xiaochao-block-switch__slider::before) {
  transform: translateX(20px);
}

.xiaochao-game-assist-tip {
  margin: 4px 0 0;
  padding: 5px 8px;
  border: 1px solid rgba(242, 222, 156, .5);
  border-radius: 5px;
  background: rgba(29, 27, 24, .96);
  color: #eee5d2;
  font-size: 12px;
  line-height: 1.45;
  white-space: pre-line;
  pointer-events: none;
}

</style>
