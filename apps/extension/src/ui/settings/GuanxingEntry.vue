<script setup lang="ts">
/** 自助观星外链入口。 */
import { createElectronPlatform } from '../../adapters/electron-platform';
import { createUserscriptPlatform } from '../../adapters/userscript-platform';

const props = defineProps<{ platform: 'electron' | 'userscript' }>();

function openPage(): void {
  const adapter = props.platform === 'electron'
    ? createElectronPlatform()
    : createUserscriptPlatform();
  void adapter.openExternal('https://gx.95chong.cn/');
}
</script>

<template>
  <button
    type="button"
    class="xiaochao-block-entry xiaochao-others-entry__link"
    data-tooltip="在浏览器新页面打开自助观星"
    @click="openPage"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3l2.5 6.4 6.9.6-5.2 4.5 1.6 6.8L12 17.8 6.2 21.3l1.6-6.8-5.2-4.5 6.9-.6L12 3z" />
    </svg>
    <span>自助观星</span>
  </button>
</template>
