<script setup>
defineProps({ title: { type: String, required: true } });
</script>

<template>
  <header class="settings-group-title">
    <h4>{{ title }}</h4>
    <slot />
  </header>
</template>

<style scoped>
.settings-group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-height: 24px;
  margin-bottom: 8px;
  padding: 0 4px;
  color: #f2de9c;
}

h4 {
  margin: 0;
  font-size: 13px;
  font-weight: 600;
  line-height: 1.3;
}
</style>
