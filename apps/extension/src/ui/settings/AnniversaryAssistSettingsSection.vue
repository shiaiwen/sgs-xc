<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import BaseDialog from '../dialog/BaseDialog.vue';
import { getAnniversaryAssistController } from '../../features/anniversary-assist/anniversary-assist-registry';
import type { AnniversaryAssistUiStatus } from '../../features/anniversary-assist/anniversary-assist-types';

const isOpen = ref(false);
const enabled = ref(false);
const creditInput = ref('');
const saveHint = ref('');
const saveBusy = ref(false);
const status = ref<AnniversaryAssistUiStatus>({
  phase: 'idle',
  message: '默认关闭',
  totals: { given: 0, received: 0, pending: 0 },
  selfTransferred: 0,
  creditAccountId: '',
  transferredContributions: [],
  todayUsed: '0/3',
  activityOpen: false,
  enabled: false,
});

let unsubscribe: (() => void) | null = null;

const entryText = computed(() => {
  if (!enabled.value) return '关';
  if (!status.value.activityOpen) return '未开';
  return status.value.todayUsed;
});

const phaseBadge = computed(() => {
  const map: Record<AnniversaryAssistUiStatus['phase'], string> = {
    idle: '待命',
    syncing: '同步',
    binding: '绑定',
    verifying: '核验',
    error: '异常',
  };
  return map[status.value.phase];
});

const ownContribution = computed(() => Math.max(0, status.value.totals.given - status.value.selfTransferred));

function bindController(): void {
  unsubscribe?.();
  const controller = getAnniversaryAssistController();
  if (!controller) return;
  status.value = controller.getStatus();
  enabled.value = status.value.enabled;
  creditInput.value = status.value.creditAccountId;
  unsubscribe = controller.subscribe((next) => {
    status.value = next;
    enabled.value = next.enabled;
    if (!isOpen.value) creditInput.value = next.creditAccountId;
  });
}

onMounted(() => bindController());
onBeforeUnmount(() => unsubscribe?.());

function openDialog(): void {
  bindController();
  saveHint.value = '';
  isOpen.value = true;
}

async function toggleEnabled(event: Event): Promise<void> {
  const controller = getAnniversaryAssistController();
  if (!controller) return;
  await controller.setEnabled((event.currentTarget as HTMLInputElement).checked);
}

function refresh(): void {
  saveHint.value = '';
  getAnniversaryAssistController()?.refresh();
}

async function saveCredit(next: string): Promise<void> {
  const controller = getAnniversaryAssistController();
  if (!controller || saveBusy.value) return;
  saveBusy.value = true;
  saveHint.value = '';
  try {
    const result = await controller.saveCreditAccount(next);
    saveHint.value = result.message;
    if (result.ok) creditInput.value = next.trim();
  } finally {
    saveBusy.value = false;
  }
}

async function saveCreditFromInput(): Promise<void> {
  await saveCredit(creditInput.value);
}

async function clearCredit(): Promise<void> {
  creditInput.value = '';
  await saveCredit('');
}
</script>

<template>
  <section class="xiaochao-settings-section" aria-label="周年庆互助">
    <div class="xiaochao-settings-section__body">
      <button
        type="button"
        class="xiaochao-block-entry"
        data-tooltip="经典版周年庆每日互绑；默认关闭；仅在大厅执行"
        @click="openDialog"
      >
        <span>周年庆互助</span>
        <span class="xiaochao-block-entry__count">{{ entryText }}</span>
      </button>
    </div>
    <BaseDialog
      :open="isOpen"
      title="周年庆互助"
      dialog-class="xiaochao-block-dialog xiaochao-anniversary-assist-dialog"
      :max-width="320"
      @close="isOpen = false"
    >
      <template #header-actions>
        <button
          type="button"
          class="xiaochao-block-select-btn"
          :disabled="!enabled"
          @click="refresh"
        >
          刷新
        </button>
      </template>

      <div class="xiaochao-anniversary-assist">
        <label
          class="xiaochao-anniversary-assist__master"
          data-tooltip="开启后在游戏大厅自动参与每日互绑"
        >
          <span class="xiaochao-anniversary-assist__master-copy">
            <span class="xiaochao-anniversary-assist__master-title">每日互助</span>
            <span class="xiaochao-anniversary-assist__master-desc">默认关闭，仅在大厅执行</span>
          </span>
          <span class="xiaochao-block-switch__toggle">
            <input
              type="checkbox"
              aria-label="每日互助"
              :checked="enabled"
              @change="toggleEnabled"
            >
            <span class="xiaochao-block-switch__slider" />
          </span>
        </label>

        <div
          class="xiaochao-anniversary-assist__status-card"
          :class="`xiaochao-anniversary-assist__status-card--${status.phase}`"
        >
          <span class="xiaochao-anniversary-assist__phase">{{ phaseBadge }}</span>
          <div class="xiaochao-anniversary-assist__status-body">
            <p class="xiaochao-anniversary-assist__message">{{ status.message }}</p>
            <p v-if="!status.activityOpen && enabled" class="xiaochao-anniversary-assist__note xiaochao-anniversary-assist__note--inline">当前不在活动时间或大厅条件不满足</p>
          </div>
        </div>

        <div class="xiaochao-anniversary-assist__stats">
          <div class="xiaochao-anniversary-assist__stat">
            <span class="xiaochao-anniversary-assist__stat-label">今日帮绑</span>
            <span class="xiaochao-anniversary-assist__stat-value">{{ status.todayUsed }}</span>
          </div>
          <div class="xiaochao-anniversary-assist__stat">
            <span class="xiaochao-anniversary-assist__stat-label">本号贡献</span>
            <span class="xiaochao-anniversary-assist__stat-value">{{ ownContribution }}</span>
          </div>
          <div class="xiaochao-anniversary-assist__stat">
            <span class="xiaochao-anniversary-assist__stat-label">转入大号</span>
            <span class="xiaochao-anniversary-assist__stat-value">{{ status.selfTransferred }}</span>
          </div>
          <div class="xiaochao-anniversary-assist__stat">
            <span class="xiaochao-anniversary-assist__stat-label">收到</span>
            <span class="xiaochao-anniversary-assist__stat-value">{{ status.totals.received }}</span>
          </div>
          <div v-if="status.totals.pending > 0" class="xiaochao-anniversary-assist__stat xiaochao-anniversary-assist__stat--pending">
            <span class="xiaochao-anniversary-assist__stat-label">待确认</span>
            <span class="xiaochao-anniversary-assist__stat-value">{{ status.totals.pending }}</span>
          </div>
        </div>

        <section class="xiaochao-anniversary-assist__section">
          <header class="xiaochao-anniversary-assist__section-head">
            <h4 class="xiaochao-anniversary-assist__section-title">归集大号</h4>
            <button
              type="button"
              class="xiaochao-anniversary-assist__text-btn"
              :disabled="saveBusy"
              @click="clearCredit"
            >
              清空
            </button>
          </header>
          <p class="xiaochao-anniversary-assist__note">记入大号的是互助贡献，不是元宝或道具。留空则算在本号。</p>
          <div class="xiaochao-anniversary-assist__credit-row">
            <input
              v-model="creditInput"
              class="xiaochao-anniversary-assist__input"
              type="text"
              inputmode="numeric"
              pattern="[0-9]*"
              maxlength="32"
              placeholder="游戏编号，可留空"
            >
            <button
              type="button"
              class="xiaochao-block-select-btn xiaochao-anniversary-assist__save-btn"
              :disabled="saveBusy"
              @click="saveCreditFromInput"
            >
              保存
            </button>
          </div>
          <p v-if="saveHint" class="xiaochao-anniversary-assist__hint" :class="{ 'xiaochao-anniversary-assist__hint--error': saveHint.includes('失败') || saveHint.includes('不能') }">
            {{ saveHint }}
          </p>
        </section>

        <section v-if="status.transferredContributions.length" class="xiaochao-anniversary-assist__section">
          <header class="xiaochao-anniversary-assist__section-head">
            <h4 class="xiaochao-anniversary-assist__section-title">小号转入明细</h4>
          </header>
          <ul class="xiaochao-anniversary-assist__table">
            <li
              v-for="row in status.transferredContributions"
              :key="row.accountId"
              class="xiaochao-anniversary-assist__table-row"
            >
              <span class="xiaochao-anniversary-assist__table-id">{{ row.accountId }}</span>
              <span class="xiaochao-anniversary-assist__table-val">+{{ row.given }}</span>
            </li>
          </ul>
        </section>
      </div>
    </BaseDialog>
  </section>
</template>
