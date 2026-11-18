<script setup lang="ts">
import { computed, ref } from 'vue';
import BaseDialog from '../dialog/BaseDialog.vue';
import {
  AUTHOR_TIP_ALIPAY_IMAGE_URL,
  AUTHOR_TIP_PAY_CHANNEL_ALIPAY,
  AUTHOR_TIP_PAY_CHANNEL_WECHAT,
  AUTHOR_TIP_WECHAT_IMAGE_URL,
  type AuthorTipPayChannel,
} from '../../const/author-tip-pay';

const DIALOG_MAX_WIDTH = 280;

const isOpen = ref(false);
const channel = ref<AuthorTipPayChannel>(AUTHOR_TIP_PAY_CHANNEL_WECHAT);

const qrImageUrl = computed(() =>
  channel.value === AUTHOR_TIP_PAY_CHANNEL_WECHAT
    ? AUTHOR_TIP_WECHAT_IMAGE_URL
    : AUTHOR_TIP_ALIPAY_IMAGE_URL
);

const channelHint = computed(() =>
  channel.value === AUTHOR_TIP_PAY_CHANNEL_WECHAT ? '微信扫一扫' : '支付宝扫一扫'
);

function openDialog(): void {
  channel.value = AUTHOR_TIP_PAY_CHANNEL_WECHAT;
  isOpen.value = true;
}

function selectChannel(next: AuthorTipPayChannel): void {
  channel.value = next;
}
</script>

<template>
  <button
    type="button"
    class="xiaochao-block-entry xiaochao-block-entry--center"
    data-tooltip="微信或支付宝赞赏作者"
    @click="openDialog"
  >
    <span>赞赏作者</span>
  </button>
  <BaseDialog
    :open="isOpen"
    title="赞赏作者"
    dialog-class="xiaochao-author-tip-dialog"
    :max-width="DIALOG_MAX_WIDTH"
    @close="isOpen = false"
  >
    <p class="xiaochao-author-tip-dialog__lead">小抄永久免费。觉得好用就扫个码支持一下，我继续好好干。</p>
    <div class="xiaochao-author-tip-dialog__tabs" role="tablist" aria-label="收款方式">
      <button
        type="button"
        role="tab"
        class="xiaochao-author-tip-dialog__tab"
        :aria-selected="channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT"
        :class="{ 'xiaochao-author-tip-dialog__tab--active': channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT }"
        @click="selectChannel(AUTHOR_TIP_PAY_CHANNEL_WECHAT)"
      >
        微信
      </button>
      <button
        type="button"
        role="tab"
        class="xiaochao-author-tip-dialog__tab"
        :aria-selected="channel === AUTHOR_TIP_PAY_CHANNEL_ALIPAY"
        :class="{ 'xiaochao-author-tip-dialog__tab--active': channel === AUTHOR_TIP_PAY_CHANNEL_ALIPAY }"
        @click="selectChannel(AUTHOR_TIP_PAY_CHANNEL_ALIPAY)"
      >
        支付宝
      </button>
    </div>
    <div class="xiaochao-author-tip-dialog__qr-wrap">
      <img
        class="xiaochao-author-tip-dialog__qr"
        :src="qrImageUrl"
        :alt="channelHint"
        width="220"
        height="220"
        loading="lazy"
        decoding="async"
      />
    </div>
    <p class="xiaochao-author-tip-dialog__hint">{{ channelHint }}</p>
  </BaseDialog>
</template>