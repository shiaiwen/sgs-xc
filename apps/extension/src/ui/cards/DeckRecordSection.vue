<script setup lang="ts">
/** 常规页牌局记录区块：本回合弃牌列表与排序。 */
import { computed, onBeforeUnmount, ref } from 'vue';
import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { DeckRecordStore } from '../../features/deck-record/deck-record-store.ts';
import type { SeatStateStore } from '../../features/seat-display/seat-state-store.ts';
import { isDianweiArmCardName, type GameCardCatalog } from '../../features/cards/game-card-catalog.ts';
import ShoupaiCardFace from './ShoupaiCardFace.vue';

const props = defineProps<{
  configStore: XiaochaoConfigStore;
  seatStateStore: SeatStateStore;
  deckRecordStore: DeckRecordStore;
  gameCardCatalog: GameCardCatalog;
}>();

const snapshot = ref(props.deckRecordStore.getSnapshot());
const seatSnapshot = ref(props.seatStateStore.getSnapshot());
const enabled = ref(props.configStore.get('display.deckRecordEnabled'));
const sortMode = ref(props.configStore.get('display.discardSortMode'));
const stopStore = props.deckRecordStore.subscribe((nextSnapshot) => {
  snapshot.value = nextSnapshot;
});
const stopSeatStore = props.seatStateStore.subscribe((nextSnapshot) => {
  seatSnapshot.value = nextSnapshot;
});
const stopConfig = props.configStore.subscribe(
  'display.deckRecordEnabled',
  ({ value }) => {
    enabled.value = value;
  }
);
const stopSortConfig = props.configStore.subscribe(
  'display.discardSortMode',
  ({ value }) => {
    sortMode.value = value;
  }
);
onBeforeUnmount(() => {
  stopStore();
  stopSeatStore();
  stopConfig();
  stopSortConfig();
});

const currentTurnDiscardCards = computed(() =>
  sortCards(snapshot.value.currentTurnDiscardCardIds)
);
const discardTitle = computed(() =>
  `本回合弃牌 · ${sortModeLabels[sortMode.value] ?? sortModeLabels[sortModes[0]]}`
);
const seatRows = computed(() => seatSnapshot.value.seats.map((seat) => {
  const confirmedCards = [...seat.knownCards, ...(seat.equipmentCards ?? [])];
  return {
    ...seat,
    handCardCount: seat.knownCards.length + seat.unknownCardCount,
    identityLabel: identityLabel(seat.identity),
    confirmedCardNames: confirmedCards.map((card) => (
      card.name || props.gameCardCatalog.resolve(card.cardId).name || `#${card.cardId}`
    )).join('、')
  };
}));
const sortModeLabels = {
  'suit-type-number': '花色→类型→点数',
  'type-suit-number': '类型→花色→点数',
  'number-suit-type': '点数→花色→类型',
} as const;
const sortModes = Object.keys(sortModeLabels) as Array<
  keyof typeof sortModeLabels
>;

function cycleSortMode(): void {
  const currentIndex = sortModes.indexOf(sortMode.value);
  props.configStore.set(
    'display.discardSortMode',
    sortModes[(currentIndex + 1) % sortModes.length]
  );
}

function sortCards(cardIds: readonly number[]) {
  const cards = cardIds.flatMap((cardId, index) => {
    const card = props.gameCardCatalog.resolve(cardId);
    if (isDianweiArmCardName(card.name)) return [];
    return [{ ...card, originalIndex: index }];
  });
  const mode = sortModeLabels[sortMode.value]
    ? sortMode.value
    : sortModes[0];
  return cards.sort((left, right) => {
    const suitDifference = suitOrder(left.suit) - suitOrder(right.suit);
    const typeDifference =
      left.cardType - right.cardType ||
      left.name.localeCompare(right.name, 'zh-CN');
    const rankDifference = rankOrder(left.rank) - rankOrder(right.rank);
    const comparisons =
      mode === 'suit-type-number'
        ? [suitDifference, typeDifference, rankDifference]
        : mode === 'type-suit-number'
        ? [typeDifference, suitDifference, rankDifference]
        : [rankDifference, suitDifference, typeDifference];
    return (
      comparisons.find((value) => value !== 0) ||
      left.originalIndex - right.originalIndex
    );
  });
}

function suitOrder(suit: string): number {
  return ['spade', 'heart', 'club', 'diamond'].indexOf(suit);
}

function rankOrder(rank: string): number {
  const faceRanks: Record<string, number> = {
    A: 1,
    J: 11,
    Q: 12,
    K: 13,
    小王: 16,
    大王: 17,
  };
  return faceRanks[rank] || Number(rank) || 99;
}

function identityLabel(identity?: number): string {
  return ({ 1: '主公', 2: '忠臣', 3: '反贼', 4: '内奸' } as Record<number, string>)[identity || 0] || '身份未知';
}
</script>

<template>
  <section v-if="enabled" class="xc-deck-record" aria-label="牌堆记录">
    <div class="xc-deck-record__group xc-deck-record__group--discard">
      <button
        type="button"
        class="xc-deck-record__discard-title"
        :title="`点击切换弃牌排序（当前：${sortModeLabels[sortMode] ?? sortModeLabels[sortModes[0]]}）`"
        @click="cycleSortMode"
      >
        {{ discardTitle }}
      </button>
      <div
        class="xc-deck-record__cards"
        :data-empty="currentTurnDiscardCards.length || snapshot.currentTurnHiddenDiscardCount ? undefined : '暂无已知牌'"
      >
        <ShoupaiCardFace
          v-for="(card, index) in currentTurnDiscardCards"
          :key="`turn-${card.cardId}-${index}`"
          :card-id="card.cardId"
          :game-card-catalog="gameCardCatalog"
        />
        <span v-if="snapshot.currentTurnHiddenDiscardCount" class="xc-deck-record__unknown">
          未知牌 × {{ snapshot.currentTurnHiddenDiscardCount }}
        </span>
      </div>
    </div>
    <div v-if="seatRows.length" class="xc-deck-record__group xc-deck-record__group--seats">
      <div class="xc-deck-record__group-title">
        <strong>八人局面</strong><span>实时手牌 / 身份 / 存活</span>
      </div>
      <div class="xc-deck-record__seat-list">
        <div v-for="seat in seatRows" :key="seat.seatId" class="xc-deck-record__seat" :class="{ 'is-dead': !seat.isAlive, 'is-self': seat.isSelf }">
          <span class="xc-deck-record__seat-number">{{ seat.displayOrder }}号</span>
          <span class="xc-deck-record__identity">{{ seat.identityLabel }}</span>
          <span class="xc-deck-record__life">{{ seat.isAlive ? '存活' : '阵亡' }}</span>
          <span class="xc-deck-record__hand">手牌 {{ seat.handCardCount }}</span>
          <span v-if="seat.confirmedCardNames" class="xc-deck-record__known" :title="`已明确：${seat.confirmedCardNames}`">明：{{ seat.confirmedCardNames }}</span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.xc-deck-record {
  width: 100%;
  box-sizing: border-box;
  padding: 6px 0 4px;
  border-top: 1px solid rgba(242, 222, 156, 0.2);
  border-bottom: 1px solid rgba(242, 222, 156, 0.2);
}
.xc-deck-record__group {
  width: 100%;
  box-sizing: border-box;
  margin: 0 0 6px;
  padding: 0;
  overflow: hidden;
  border: 0;
}
.xc-deck-record__group:last-child { margin-bottom: 0; }
.xc-deck-record__group-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin: 0 6px 2px;
  min-height: 0;
  color: #f2de9c;
  font: 700 12px/1.4 SimSun, serif;
}
.xc-deck-record__group-title span {
  color: #b7aa8b;
  font: 400 10px/1.4 SimSun, serif;
}
.xc-deck-record__discard-title {
  display: block;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  width: calc(100% - 12px);
  margin: 0 6px 2px;
  padding: 2px 0;
  border: 0;
  background: transparent;
  color: #e8d4a8;
  font: 700 12px/1.4 SimSun, serif;
  text-align: left;
  cursor: pointer;
}
.xc-deck-record__discard-title:hover {
  color: #fff3d0;
}
/* 卡牌页牌堆容器：无重框，左浮小牌。 */
.xc-deck-record__cards {
  position: relative;
  display: block;
  width: auto;
  min-height: 36px;
  margin: 0 2px;
  padding: 2px 4px 4px;
  overflow: hidden;
  text-align: left;
  box-sizing: border-box;
}
.xc-deck-record__cards:empty::after {
  content: attr(data-empty);
  color: rgba(183, 170, 139, .75);
  font: 12px/36px SimSun, serif;
  padding-left: 4px;
}
.xc-deck-record__unknown {
  float: left;
  margin: 4px 0 0 2px;
  padding: 2px 5px;
  border: 1px dashed rgba(201, 161, 93, 0.45);
  border-radius: 3px;
  background: rgba(34, 27, 19, 0.85);
  color: #a99a7a;
  font: 11px/1.4 SimSun, serif;
}
.xc-deck-record__seat-list {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 3px;
  margin: 0 5px 2px;
}
.xc-deck-record__seat {
  display: flex;
  flex-wrap: wrap;
  min-width: 0;
  align-items: center;
  gap: 3px;
  padding: 3px 4px;
  border: 1px solid rgba(201, 161, 93, .24);
  border-radius: 3px;
  color: #e8d4a8;
  font: 11px/1.35 SimSun, serif;
}
.xc-deck-record__seat.is-self { border-color: rgba(255, 216, 120, .72); }
.xc-deck-record__seat.is-dead { opacity: .48; text-decoration: line-through; }
.xc-deck-record__seat-number { color: #f8e6b6; white-space: nowrap; }
.xc-deck-record__identity { color: #d8a363; white-space: nowrap; }
.xc-deck-record__life { color: #91c78c; white-space: nowrap; }
.xc-deck-record__seat.is-dead .xc-deck-record__life { color: #bd7777; }
.xc-deck-record__hand { color: #c7b98e; white-space: nowrap; }
.xc-deck-record__known {
  flex: 0 0 100%;
  overflow: hidden;
  color: #a99a7a;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
