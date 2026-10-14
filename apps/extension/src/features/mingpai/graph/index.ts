/**
 * 牌位图对外导出：槽位、区域、计数器与明牌标签。
 */

export {
  CardFace,
  CardSlot,
  CardZone,
  DRAW_PILE_BOTTOM,
  DRAW_PILE_TOP,
  GLOBAL_OWNER,
  POSITION_UNSPECIFIED,
  UNKNOWN_ZONE,
  cardCounter,
  filterSlots,
  findSlot,
  findSlotIds,
  findSlotZones,
  forgetMingpaiCardTag,
  formatZoneId,
  getCardGraphClock,
  getMingpaiCardTags,
  getMingpaiQiOwner,
  getOfficialMingpaiHandCards,
  getPersistentMingpaiCardTags,
  getReshufflePoolKeys,
  getSlotsByKey,
  initCardGraph,
  isCardGraphReady,
  isHiddenGroupKey,
  isOpenGroupKey,
  isStickyMingpaiTag,
  moveSlots,
  mergeMingpaiCardTags,
  packSlots,
  parseZoneId,
  peekSlotCounter,
  refreshZone,
  rememberMingpaiCardTags,
  rememberMingpaiQiCards,
  resetMingpaiTags,
  retainPersistentMingpaiCardTags,
  setCardGraphClock,
  setCardGraphHooks,
  syncOfficialMingpaiHandCards,
  unpackSlots,
  type CardFaceInfo,
  type CardGraphClock,
  type CardGraphHooks,
  type CardSlotId,
  type CardSlotKey,
  type CardSlotZone,
  type SlotLookupResult
} from './card-graph.ts';

export {
  advanceGridTrace,
  advanceSeatGridTrace,
  advanceUniqueSeatGridTrace,
  applyPendingDeckReturn,
  clearTempZoneGrids,
  correctIdentifiedCards,
  createTempZoneGrid,
  downgradeTempZoneGrid,
  findTempZoneGrid,
  getTempZoneGrids,
  isExternalSwapSpell,
  isTrackedTempZone,
  markGridCardsReturned,
  planPendingDeckReturn,
  registerTempZoneGrid,
  removeZoneCards,
  retargetZonePosition,
  swapZoneCardsByKey,
  takeGridCards,
  takeGridCardsByPosition,
  takeGridCardsForSpell,
  type PendingDeckReturn,
  type TempZoneGrid
} from './temporary-zone-grid.ts';

export {
  applyGraphMove,
  isMoveIgnored,
  isSameZoneShow,
  isWholeHandShow,
  type GraphMoveMessage,
  type GraphMoveResult,
  type GraphMoveState,
  type MoveHandling
} from './move-pipeline.ts';

export { createGraphMingpaiEngine } from './graph-engine.ts';

export {
  expandGroupCandidates,
  getSeatKnownCardIds,
  getSeatPossibleCardIds,
  getSeatUncertainGroups,
  getUncertainGroups,
  getZone4Rows,
  groupHasUnknownCandidate,
  parseZone4Key,
  type UncertainGroup,
  type Zone4Row
} from './mingpai-candidates.ts';
