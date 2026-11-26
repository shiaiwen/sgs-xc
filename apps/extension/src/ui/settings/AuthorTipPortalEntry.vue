<script setup lang="ts">
import { computed } from 'vue';
import { createElectronPlatform } from '../../adapters/electron-platform';
import { createUserscriptPlatform } from '../../adapters/userscript-platform';
import {
  AUTHOR_TIP_PORTAL_ORIGIN_LOCAL,
  authorTipPortalUrl,
} from '../../const/author-tip-portal';

const props = defineProps<{ platform: 'electron' | 'userscript' }>();

const entryTooltip = computed(() => {
  const url = authorTipPortalUrl();
  if (url.startsWith(AUTHOR_TIP_PORTAL_ORIGIN_LOCAL)) {
    return `在浏览器打开本地门户赞赏页。需先启动门户 ${AUTHOR_TIP_PORTAL_ORIGIN_LOCAL}`;
  }
  return '在浏览器打开门户赞赏页，自动弹出收款码';
});

function openAuthorTipPortal(): void {
  const adapter = props.platform === 'electron'
    ? createElectronPlatform()
    : createUserscriptPlatform();
  void adapter.openExternal(authorTipPortalUrl());
}
</script>

<template>
  <button
    type="button"
    class="xiaochao-block-entry xiaochao-block-entry--center xiaochao-others-entry__link xiaochao-others-entry__link--author-tip"
    :data-tooltip="entryTooltip"
    @click="openAuthorTipPortal"
  >
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 21s-6.6-4.2-9.2-8.2C.9 10 1.4 6.2 4.6 4.9 6.7 4.1 8.8 4.8 12 7.6c3.2-2.8 5.3-3.5 7.4-2.7 3.2 1.3 3.7 5.1 1.8 7.9C18.6 16.8 12 21 12 21z" />
    </svg>
    <span>赞赏作者</span>
  </button>
</template>
