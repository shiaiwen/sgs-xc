<script setup lang="ts">
/** 常规页技能辅助区块：宴戏、严教等条文展示。 */
import { computed, onBeforeUnmount, ref } from 'vue';
import type { SkillAssistStore, YanjiaoAssignOutcome } from '../../features/skill-assist/skill-assist-store.ts';
import type { YanjiaoSide } from '../../features/skill-assist/yanjiao-assign.ts';
import { YANJIAO_ASSIGN_FEEDBACK_MS } from '../../const/yanjiao.ts';
import type { GameCardCatalog } from '../../features/cards/game-card-catalog.ts';
import { parseSuitToken } from '../../features/skill-assist/quanbian.ts';
import ShoupaiCardFace from './ShoupaiCardFace.vue';

const props = defineProps<{
  skillAssistStore: SkillAssistStore;
  gameCardCatalog: GameCardCatalog;
  /** 只显示这一块。曹金玉和权道分开挂，不进同一组。 */
  soloPanelId?: string;
}>();

const snapshot = ref(props.skillAssistStore.getSnapshot());
const stop = props.skillAssistStore.subscribe((next) => {
  snapshot.value = next;
});
onBeforeUnmount(stop);

const visiblePanels = computed(() =>
  snapshot.value.panels.filter((panel) => {
    if (!panel.visible) return false;
    if (props.soloPanelId) return panel.id === props.soloPanelId;
    return panel.id !== 'yuqi';
  })
);

function suitParts(token: string) {
  return parseSuitToken(token);
}

const copiedOptionKey = ref('');
let copiedTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(copiedTimer));

async function copyOption(key: string, text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  copiedOptionKey.value = key;
  clearTimeout(copiedTimer);
  copiedTimer = setTimeout(() => {
    copiedOptionKey.value = '';
  }, 500);
}

const ASSIGN_FEEDBACK: Record<YanjiaoAssignOutcome, string> = {
  assigned: '已分好，点游戏里的确定',
  'no-window': '严教分牌窗口还没打开',
  'not-mine': '这次不是你分牌',
  'cards-mismatch': '窗口里的牌和方案对不上',
  unavailable: '严教分牌窗口还没打开'
};
const assignFeedback = ref<{ key: string; text: string } | null>(null);
let assignTimer: ReturnType<typeof setTimeout> | undefined;
onBeforeUnmount(() => clearTimeout(assignTimer));

function assignYanjiao(key: string, index: number, side: YanjiaoSide): void {
  const outcome = props.skillAssistStore.assignYanjiao(index, side);
  assignFeedback.value = { key, text: ASSIGN_FEEDBACK[outcome] };
  clearTimeout(assignTimer);
  assignTimer = setTimeout(() => {
    assignFeedback.value = null;
  }, YANJIAO_ASSIGN_FEEDBACK_MS);
}
</script>

<template>
  <section
    v-if="snapshot.inGame && visiblePanels.length"
    class="card-tab-hero-section xc-vue-skill-assist"
  >
    <article
      v-for="panel in visiblePanels"
      :key="panel.id"
      class="xc-hero-block card-tab-panel xc-hero-active"
      :data-feature="panel.id"
    >
      <div
        v-if="panel.showSuitSequence"
        class="card-hero-feature-line"
      >
        <span class="card-detail-feature-title">{{ panel.title }}</span>
        <div class="suitRec" :data-feature-suit="panel.id">
          <span
            v-for="(token, index) in panel.suitTokens"
            :key="`${panel.id}-suit-${index}`"
            class="xc-suit-token"
            :class="[suitParts(token).suitClass, { R: suitParts(token).isRed }]"
          >
            <span class="suit-glyph">{{ suitParts(token).glyph }}</span>{{ suitParts(token).rank }}
          </span>
        </div>
      </div>
      <div
        v-else
        class="card-detail-feature-title"
      >
        {{ panel.title }}
      </div>

      <div
        v-if="panel.shownCardZoneId && panel.cardIds.length"
        class="knownCards quanBianYanXi"
        :data-empty-label="panel.emptyCardLabel || undefined"
      >
        <ShoupaiCardFace
          v-for="cardId in panel.cardIds"
          :key="`${panel.id}-${cardId}`"
          :card-id="cardId"
          :game-card-catalog="gameCardCatalog"
        />
      </div>

      <div
        v-if="panel.showResult && panel.resultText"
        class="function res card-detail-feature-result"
        :data-feature-result="panel.id"
      >
        {{ panel.resultText }}
      </div>

      <div
        v-if="panel.assignable && panel.splitOptions.length"
        class="xc-skill-options"
      >
        <div class="xc-skill-assign-hint">点下方数字可以自动分配牌<br>点想分给自己的那一组</div>
        <div
          v-for="(split, index) in panel.splitOptions"
          :key="`${panel.id}-assign-${index}`"
          class="xc-skill-option xc-skill-assign-row"
        >
          <template v-if="assignFeedback?.key === `${panel.id}-${index}`">
            {{ assignFeedback.text }}
          </template>
          <template v-else-if="copiedOptionKey === `${panel.id}-${index}`">
            复制成功
          </template>
          <template v-else>
            <button
              type="button"
              class="xc-skill-assign-side"
              title="这一组分给自己"
              @click="assignYanjiao(`${panel.id}-${index}`, index, 'left')"
            >{{ split.left }}</button>
            <span>=</span>
            <button
              type="button"
              class="xc-skill-assign-side"
              title="这一组分给自己"
              @click="assignYanjiao(`${panel.id}-${index}`, index, 'right')"
            >{{ split.right }}</button>
            <button
              type="button"
              class="xc-skill-assign-copy"
              title="点击复制"
              @click="copyOption(`${panel.id}-${index}`, panel.resultOptions[index] ?? '')"
            >复制</button>
          </template>
        </div>
      </div>
      <div
        v-else-if="panel.resultOptions.length"
        class="xc-skill-options"
      >
        <button
          v-for="(option, index) in panel.resultOptions"
          :key="`${panel.id}-option-${index}`"
          type="button"
          class="xc-skill-option"
          :class="{ 'xc-skill-option--highlight': panel.highlightedOptions[index] }"
          title="点击复制"
          @click="copyOption(`${panel.id}-${index}`, option)"
        >
          {{ copiedOptionKey === `${panel.id}-${index}` ? '复制成功' : option }}
        </button>
      </div>
    </article>
  </section>
</template>

<style scoped>
.xc-vue-skill-assist {
  width: 100%;
  overflow: hidden;
  clear: both;
}

.xc-hero-block {
  display: block;
  margin: 0 0 6px;
  padding: 6px 8px;
}

.xc-hero-block + .xc-hero-block {
  border-top: 1px solid rgba(242, 222, 156, .25);
}

.card-detail-feature-title,
.card-detail-feature-result {
  white-space: pre-line;
}

.card-detail-feature-title {
  margin-bottom: 3px;
  color: #f2de9c;
  font-size: 12px;
  font-weight: 700;
  line-height: 1.4;
}

.card-hero-feature-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}

.card-hero-feature-line .suitRec {
  float: none;
  flex: 1 1 auto;
  width: auto;
  text-align: right;
  min-height: 16px;
}

.xc-suit-token {
  display: inline-block;
  margin-left: 2px;
  font-weight: 700;
  font-size: 12px;
  color: #2c2c2c;
}

.xc-suit-token.R,
.xc-suit-token.suit-heart,
.xc-suit-token.suit-diamond {
  color: #f04155;
}

.xc-suit-token.suit-spade {
  color: #2c2c2c;
}

.xc-suit-token.suit-club {
  color: #787878;
}

.xc-suit-token .suit-glyph {
  font-size: 1.05em;
}

.card-detail-feature-result {
  margin: 4px 0 2px;
  text-align: center;
  color: #f2de9c;
  font-size: 12px;
  line-height: 1.4;
  white-space: pre-wrap;
}

.xc-skill-options {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin: 4px 0 2px;
}

.xc-skill-option {
  box-sizing: border-box;
  width: 100%;
  padding: 3px 6px;
  text-align: center;
  border: 1px solid rgba(201, 161, 93, .55);
  border-radius: 3px;
  background: rgba(34, 27, 19, .85);
  color: #e8d4a8;
  font: 700 12px/1.5 SimSun, serif;
  cursor: pointer;
}

.xc-skill-option--highlight {
  border-color: #f2de9c;
  color: #ffd76a;
}

.xc-skill-assign-hint {
  text-align: center;
  color: #c9c1b1;
  font-size: 11px;
  line-height: 1.4;
}

.xc-skill-assign-row {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  cursor: default;
}

.xc-skill-assign-side {
  padding: 0 4px;
  border: 1px solid transparent;
  border-radius: 3px;
  background: none;
  color: inherit;
  font: inherit;
  cursor: pointer;
}

.xc-skill-assign-side:hover {
  border-color: #f2de9c;
  color: #ffd76a;
}

.xc-skill-assign-copy {
  margin-left: 4px;
  padding: 0 4px;
  border: 1px solid rgba(201, 161, 93, .55);
  border-radius: 3px;
  background: none;
  color: #c9c1b1;
  font: 400 11px/1.4 SimSun, serif;
  cursor: pointer;
}

.xc-skill-assign-copy:hover {
  border-color: #f2de9c;
  color: #fff3d0;
}

.xc-skill-option:hover {
  border-color: #c9a15d;
  color: #fff3d0;
  background: rgba(46, 36, 24, .96);
}

.knownCards {
  width: 94%;
  text-align: center;
  position: relative;
  overflow: hidden;
  height: auto;
  min-height: 40px;
  margin: 2px auto 4px;
}

.knownCards::after {
  text-align: center;
  content: attr(data-empty-label);
  position: absolute;
  bottom: 0;
  right: 5px;
  z-index: -1;
  font: 800 20px 'Arial Black', sans-serif;
  color: #f2de9c;
  pointer-events: none;
}
</style>
