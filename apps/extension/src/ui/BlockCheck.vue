<script setup>
/** 面板用勾选框：样式见 panel-shell-styles 里的 xiaochao-block-check。 */
defineProps({
  label: {
    type: String,
    required: true,
  },
  tooltip: {
    type: String,
    default: '',
  },
  checked: {
    type: Boolean,
    required: true,
  },
  disabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['change', 'mouseenter', 'mouseleave']);

function onChange(event) {
  emit('change', event);
}
</script>

<template>
  <div
    class="xiaochao-block-check"
    :class="{ 'xiaochao-block-check--disabled': disabled }"
    :data-tooltip="tooltip"
    :title="tooltip"
    @mouseenter="emit('mouseenter')"
    @mouseleave="emit('mouseleave')"
  >
    <label class="xiaochao-block-check__hit">
      <input
        type="checkbox"
        :aria-label="label"
        :checked="checked"
        :disabled="disabled"
        @change="onChange"
      >
      <span class="xiaochao-block-check__box" />
      <span class="xiaochao-block-check__label">{{ label }}</span>
    </label>
  </div>
</template>

<style scoped>
.xiaochao-block-check__hit {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  min-width: 0;
  margin: 0;
  cursor: pointer;
}

.xiaochao-block-check--disabled .xiaochao-block-check__hit {
  cursor: default;
  pointer-events: none;
}

.xiaochao-block-check__box {
  margin-left: 0;
}
</style>