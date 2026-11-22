<script setup>
/** 游戏辅助开关：进阶辅助、自动托管、自动换将、百胜、酒馆目标。 */
import { onBeforeUnmount, reactive } from 'vue';
import BlockCheck from '../BlockCheck.vue';
import {
  AUTO_BOT_ENABLED_KEY,
  AUTO_HG_ENABLED_KEY,
  BAI_SHENG_ENABLED_KEY,
  EXTRA_ASSIST_CHARACTER_SETTINGS,
} from '../../features/extra-assist/extra-assist-settings';

const props = defineProps({
  configStore: {
    type: Object,
    required: true,
  },
});

const values = reactive(Object.fromEntries(
  EXTRA_ASSIST_CHARACTER_SETTINGS.map(({ key }) => [key, props.configStore.get(key)])
));
const unsubscribe = EXTRA_ASSIST_CHARACTER_SETTINGS.map(({ key }) =>
  props.configStore.subscribe(key, ({ value }) => {
    values[key] = value;
  })
);

// 自动化入口已下线；同步关闭历史遗留的开启状态，避免功能隐藏后仍在后台运行。
for (const key of [AUTO_BOT_ENABLED_KEY, AUTO_HG_ENABLED_KEY, BAI_SHENG_ENABLED_KEY]) {
  if (props.configStore.get(key) === true) props.configStore.set(key, false);
}

onBeforeUnmount(() => unsubscribe.forEach((stop) => stop()));

function updateSetting(key, event) {
  props.configStore.set(key, event.currentTarget.checked);
}

</script>

<template>
  <section class="xiaochao-settings-section" aria-label="辅助功能">
    <div class="xiaochao-settings-section__body">
      <div class="xiaochao-assist-characters">
        <BlockCheck
          v-for="setting in EXTRA_ASSIST_CHARACTER_SETTINGS"
          :key="setting.key"
          class="xiaochao-assist-character-check"
          :label="setting.label"
          :tooltip="setting.tooltip"
          :checked="values[setting.key]"
          @change="updateSetting(setting.key, $event)"
        />
      </div>
    </div>
  </section>
</template>

<style scoped>
.xiaochao-assist-characters {
  display: flex;
  flex-wrap: wrap;
  gap: 6px 16px;
  margin: 4px 8px 10px 14px;
}

.xiaochao-assist-character-check {
  min-width: 0;
}

.xiaochao-assist-character-check :deep(.xiaochao-block-check__label) {
  font-size: 12px;
}

</style>
