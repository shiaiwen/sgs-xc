/**
 * 原生明牌预览。
 *
 * 其他座位武将牌下方画小牌条：确定牌一排。能叫出牌名的可能牌另起一排，仍用半透明和红色问号。
 * 技能不画成小牌。只有问号、叫不出牌名的一组不画。
 * 悬停或点击弹出官方牌面。队友标记和心幽标签也从这里刷回游戏牌面。
 * 显示总开关关掉或不在局内时拆掉全部节点。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { GameCardCatalog } from '../cards/game-card-catalog.ts';
import {
  createOfficialCardView,
  detachOfficialDrawLayer,
  OFFICIAL_CARD_BASE_HEIGHT,
  OFFICIAL_CARD_BASE_WIDTH,
  releaseOfficialCardView,
  type OfficialCardView
} from '../cards/official-card-renderer.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { readSeatHandCardCount, readShownHandEntries } from '../seat-display/seat-game-adapter.ts';
import type { GameSeatSnapshot } from '../seat-display/seat-state.ts';
import type { SeatStateStore } from '../seat-display/seat-state-store.ts';
import { HAND_ZONE, type MingpaiEngine } from './mingpai-engine.ts';
import {
  buildSeatPossibleGroupViews,
  seatHasHandPossibleIntelligence,
  getSeatPossibleCardIds,
  getZone4Rows,
  possibleGroupPopupCardIds,
  possibleGroupPopupLabel,
  toPossibleGroupView,
  zone4RowHasCards,
  type PossibleGroupView,
  type Zone4Row
} from './graph/mingpai-candidates.ts';
import { TANQUE_STATE_ID, tanqueDiffLabel } from './rules/tanque-label.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  isNamedPossibleGroup,
  mingpaiStripTiles,
  partitionZone4RowsForStrip,
  stripBlockedSkillCardIds,
  ZONE4_STRIP_ROWS_ENABLED,
  zone4CardIds,
  zone4HandSourceTag
} from './zone4-strip-display.ts';
import {
  cancelMingpaiPostGameCleanup,
  registerMingpaiPostGameCleanup,
  scheduleMingpaiPostGameCleanup
} from './game-end-cleanup.ts';
import {
  isNativeHudSuspended,
  registerNativeHudPostGameTeardown
} from '../../runtime/native-hud-post-game-guard.ts';
import { mingpaiPerf, now, recordNativeSync } from './mingpai-perf.ts';
import { clampExtensionZOrder, EXTENSION_Z_BELOW_GAME_TIP } from '../../runtime/game-tip-layer.ts';

type UnknownRecord = Record<string, unknown>;
interface Rect { x: number; y: number; width: number; height: number }

// 明牌卡牌预览的布局常量。
const TILE_WIDTH = 41;
const TILE_HEIGHT = 50;
const TILE_GAP = 4;
const ROW_GAP = 4;
const MAX_VISIBLE_TILES = 5;
const POSSIBLE_ALPHA = 0.72;
const POSSIBLE_MARK_COLOR = '#D90000';
const POPUP_SECTION_GAP = 10;
const STRIP_SCALE = 2 / 3;
const VIEWPORT_MARGIN = 12;
const STRIP_OFFSET_X = 2;
const STRIP_OFFSET_Y = 10;
const POPUP_OFFSET = 14;
const POPUP_CARD_SCALE = 0.85;
const POPUP_PADDING = 8;
const POPUP_CARD_GAP = 8;
const POPUP_MIN_OVERLAP_GAP = 5;
const POPUP_TITLE_HEIGHT = 26;
const HIDE_DELAY_MS = 120;
const POLL_INTERVAL_MS = 500;
const POLL_INTERVAL_OUT_OF_GAME_MS = 2000;
/** 同一次事件链可能同时触发座位状态、明牌引擎和游戏事件订阅；
 *  短延迟合并多次 scheduleSync，避免连续重绘。 */
const SYNC_DEBOUNCE_MS = 16;
const GAME_FONT = 'fzltchjw';
const NATIVE_GUARD_KEY = '__xcVueMingpaiNativeGuard';

interface SeatStrip {
  seatId: number;
  seatUi: UnknownRecord;
  strip: UnknownRecord;
  signature: string;
  cardIds: number[];
  possibleGroups: PossibleGroupView[];
  /** 技能标记区（zone 4）的行，弹层里单独分栏。 */
  zone4Rows: Zone4Row[];
  tagsByCardId: Map<number, string[]>;
  anchor: Rect | null;
  nativeSprite: UnknownRecord | null;
}

/** 在其他武将牌下方用 Laya 画明牌小牌条，悬停弹出官方牌面列表。 */
export function installNativeMingpaiPreviewController(
  configStore: XiaochaoConfigStore,
  seatStateStore: SeatStateStore,
  gameCardCatalog: GameCardCatalog,
  mingpaiEngine?: MingpaiEngine,
  gameEvents?: GameEventBus
): () => void {
  let stopped = false;
  /** 收到 game-ended 后不再挂 Laya 层，直到下一局 game-started。 */
  let previewSuspended = false;
  let scene: UnknownRecord | null = null;
  const strips = new Map<number, SeatStrip>();
  /** 从 HandShowCards 补进手牌区的牌。离开展示列表时只移走这些。 */
  const officialShownBySeat = new Map<number, Set<number>>();
  const recommendedBySeat = new Map<number, Set<number>>();
  const selectedBySeat = new Map<number, Set<number>>();
  const markTimers = new Map<number, number>();
  const tagMethodPatches: { prototype: object; descriptor: PropertyDescriptor }[] = [];
  const patchedTagPrototypes = new WeakSet<object>();
  let cardTagCache = new WeakMap<UnknownRecord, { cardId: number; tags: string; keepOnCard: boolean }>();
  let syncing = false;
  let lastEquipmentTagRefreshAt = 0;
  let pollTimer = 0;
  let syncTimer = 0;
  let popup: UnknownRecord | null = null;
  let popupCards: OfficialCardView[] = [];
  let popupSeatId: number | null = null;
  let popupSignature = '';
  let pinnedSeatId: number | null = null;
  let hideTimer = 0;

  const clearHideTimer = () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = 0;
  };
  const scheduleHide = () => {
    if (pinnedSeatId !== null) return;
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      destroyPopup();
    }, HIDE_DELAY_MS);
  };

  function destroyPopup(): void {
    popupCards.forEach((view) => releaseOfficialCardView(view));
    popupCards = [];
    popupSeatId = null;
    popupSignature = '';
    if (popup) {
      detachOfficialDrawLayer(popup);
      try {
        call(popup, 'removeSelf');
        if (typeof popup.addDrawChild !== 'function') call(popup, 'destroy', false);
      } catch {
        // 场景切换时节点可能已销毁。
      }
    }
    popup = null;
  }

  function destroyStrip(entry: SeatStrip): void {
    restoreNativeSprite(entry);
    destroyNode(entry.strip);
    strips.delete(entry.seatId);
    if (popupSeatId === entry.seatId) destroyPopup();
    if (pinnedSeatId === entry.seatId) pinnedSeatId = null;
  }

  function destroyAll(): void {
    releaseSceneNativeHandGuards(asRecord(scene) ?? asRecord(locateGameScene(window)));
    clearHideTimer();
    destroyPopup();
    [...strips.values()].forEach(destroyStrip);
    scene = null;
    pinnedSeatId = null;
    officialShownBySeat.clear();
  }

  function ensureScene(): UnknownRecord | null {
    const nextScene = asRecord(locateGameScene(window));
    if (!nextScene || nextScene.destroyed) {
      destroyAll();
      return null;
    }
    if (scene !== nextScene) destroyAll();
    scene = nextScene;
    return scene;
  }

  function readStage(): UnknownRecord | null {
    return asRecord(asRecord((globalThis as UnknownRecord).Laya)?.stage);
  }

  function anchorOnStage(entry: SeatStrip): Rect | null {
    if (!entry.anchor) return null;
    const stage = readStage();
    if (!stage) return null;
    const topLeft = toRootPoint(entry.seatUi, stage, entry.anchor.x, entry.anchor.y);
    const bottomRight = toRootPoint(
      entry.seatUi,
      stage,
      entry.anchor.x + entry.anchor.width,
      entry.anchor.y + entry.anchor.height
    );
    if (!topLeft || !bottomRight) return null;
    return {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y)
    };
  }

  function attachStripTilePointerEvents(tile: UnknownRecord, entry: SeatStrip): void {
    tile.mouseEnabled = true;
    tile.mouseThrough = false;
    tile.hitTestPrior = false;
    const Event = readLayaEvent();
    const seatId = entry.seatId;
    call(tile, 'on', Event?.ROLL_OVER ?? 'mouseover', entry, () => {
      if (pinnedSeatId !== null && pinnedSeatId !== seatId) return;
      clearHideTimer();
      showPopup(entry);
    });
    call(tile, 'on', Event?.ROLL_OUT ?? 'mouseout', entry, scheduleHide);
    call(tile, 'on', Event?.CLICK ?? 'click', entry, (event: UnknownRecord) => {
      call(event, 'stopPropagation');
      clearHideTimer();
      pinnedSeatId = pinnedSeatId === seatId ? null : seatId;
      if (pinnedSeatId === null) destroyPopup();
      else showPopup(entry);
    });
  }

  function ensureStripOnStage(strip: UnknownRecord): boolean {
    const stage = readStage();
    if (!stage) return false;
    if (strip.parent === stage) return true;
    try {
      call(strip, 'removeSelf');
      call(stage, 'addChild', strip);
      return strip.parent === stage;
    } catch {
      return false;
    }
  }

  function readStageViewport(): Rect {
    const stage = readStage();
    if (!stage) return { x: 0, y: 0, width: 1600, height: 900 };
    return {
      x: 0,
      y: 0,
      width: Math.max(1, Number(stage.width) || 1600),
      height: Math.max(1, Number(stage.height) || 900)
    };
  }

  function anchorRectOnStage(seatUi: UnknownRecord, anchor: Rect): Rect | null {
    const stage = readStage();
    if (!stage) return null;
    const topLeft = toRootPoint(seatUi, stage, anchor.x, anchor.y);
    const bottomRight = toRootPoint(
      seatUi,
      stage,
      anchor.x + anchor.width,
      anchor.y + anchor.height
    );
    if (!topLeft || !bottomRight) return null;
    return {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y)
    };
  }

  function createStrip(seatId: number, seatUi: UnknownRecord): SeatStrip | null {
    const strip = createSprite(`xcVueMingpaiPreviewStrip-${seatId}`);
    if (!strip || !ensureStripOnStage(strip)) return null;
    strip.mouseEnabled = true;
    strip.mouseThrough = true;
    strip.zOrder = clampExtensionZOrder(100 + seatId);
    const entry: SeatStrip = {
      seatId, seatUi, strip, signature: '', cardIds: [], possibleGroups: [], zone4Rows: [],
      tagsByCardId: new Map(), anchor: null, nativeSprite: null
    };
    strips.set(seatId, entry);
    return entry;
  }

  function equipmentHintText(seatId: number): string {
    const seat = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === seatId);
    return [...new Set((seat?.equipmentCards ?? []).flatMap((card) => card.hints ?? []))].join(' ');
  }

  function buildPopupPossibleGroups(
    seat: GameSeatSnapshot,
    knownCardIds: readonly number[],
    engineHandIds: readonly number[],
    equipmentIds: ReadonlySet<number>,
    skillZoneCardIds: ReadonlySet<number>
  ): PossibleGroupView[] {
    if (!seatHasHandPossibleIntelligence(seat.seatId)) return [];
    const knownIdSet = new Set([...knownCardIds, ...engineHandIds]);
    const excludePossible = new Set([...knownIdSet, ...equipmentIds, ...skillZoneCardIds]);
    let possibleGroups = mingpaiEngine
      ? buildSeatPossibleGroupViews(seat.seatId, excludePossible)
      : [];
    const coveredPossibleIds = new Set(possibleGroups.flatMap((group) => (
      group.candidateCardIds.filter((cardId) => cardId > 0)
    )));
    const snapshotPossibleIds = [...new Set((seat.possibleCards ?? []).map((card) => card.cardId))]
      .filter((cardId) => cardId > 0 && !equipmentIds.has(cardId) && !knownIdSet.has(cardId));
    if (!mingpaiEngine) {
      const graphPossibleIds = getSeatPossibleCardIds(seat.seatId);
      snapshotPossibleIds.push(...graphPossibleIds.filter((cardId) => !snapshotPossibleIds.includes(cardId)));
    }
    snapshotPossibleIds
      .filter((cardId) => !coveredPossibleIds.has(cardId))
      .forEach((cardId) => {
        possibleGroups.push(toPossibleGroupView({
          key: -cardId,
          label: '',
          count: 1,
          candidateCardIds: [cardId],
          hasUnknownCandidate: false
        }));
      });
    return possibleGroups;
  }

  function renderStrip(
    entry: SeatStrip,
    cardIds: number[],
    possibleGroups: PossibleGroupView[],
    tagsByCardId: Map<number, string[]>,
    zone4Rows: Zone4Row[],
    skillCardIds: ReadonlySet<number>,
    anchor: Rect
  ): void {
    const tiles = mingpaiStripTiles({
      knownCardIds: cardIds,
      possibleGroups,
      skillCardIds,
      cardName: (cardId) => gameCardCatalog.resolve(cardId).name
    });
    const rows = [
      { possible: false, items: tiles.filter((tile) => !tile.possible) },
      { possible: true, items: tiles.filter((tile) => tile.possible) }
    ].filter((row) => row.items.length);
    const hintText = equipmentHintText(entry.seatId);
    const signature = `${tiles.map((tile) => `${tile.cardId}:${tile.possible ? 1 : 0}`).join(',')}|${hintText}`;
    if (entry.signature !== signature) {
      readChildren(entry.strip).forEach(destroyNode);
      rows.forEach((row, rowIndex) => {
        const y = rowIndex * (TILE_HEIGHT + ROW_GAP);
        const truncated = row.items.length > MAX_VISIBLE_TILES;
        const visible = truncated ? row.items.slice(0, MAX_VISIBLE_TILES - 1) : row.items;
        visible.forEach((item, index) => {
          // strip tiles: card face only; no source/tag label text (native labels use refreshNativeCardTags)
          const tile = createTile(item.cardId, row.possible);
          if (!tile) return;
          call(tile, 'pos', (TILE_WIDTH + TILE_GAP) * index, y);
          tile.zOrder = index + 2;
          attachStripTilePointerEvents(tile, entry);
          call(entry.strip, 'addChild', tile);
        });
        if (truncated) {
          const ellipsis = createEllipsisTile();
          if (ellipsis) {
            call(ellipsis, 'pos', (TILE_WIDTH + TILE_GAP) * visible.length, y);
            ellipsis.zOrder = visible.length + 2;
            attachStripTilePointerEvents(ellipsis, entry);
            call(entry.strip, 'addChild', ellipsis);
          }
        }
      });
      if (hintText) {
        const hint = createText(hintText, 12, '#E6C56A', 'left', true);
        if (hint) {
          call(hint, 'pos', 0, rows.length * (TILE_HEIGHT + ROW_GAP));
          hint.zOrder = 1;
          call(entry.strip, 'addChild', hint);
        }
      }
      call(entry.strip, 'sortChildren');
      entry.signature = signature;
    }
    entry.cardIds = cardIds;
    entry.possibleGroups = possibleGroups;
    entry.zone4Rows = zone4Rows;
    entry.tagsByCardId = tagsByCardId;
    entry.anchor = anchor;
    if (!ensureStripOnStage(entry.strip)) return;
    const stageAnchor = anchorRectOnStage(entry.seatUi, anchor);
    if (!stageAnchor) return;
    const tileCount = Math.max(0, ...rows.map((row) => Math.min(row.items.length, MAX_VISIBLE_TILES)));
    const width = tileCount * TILE_WIDTH + Math.max(0, tileCount - 1) * TILE_GAP;
    const height = rows.length * TILE_HEIGHT + Math.max(0, rows.length - 1) * ROW_GAP;
    const viewport = readStageViewport();
    const scaledWidth = width * STRIP_SCALE;
    const scaledHeight = height * STRIP_SCALE;
    const x = clamp(
      stageAnchor.x - STRIP_OFFSET_X,
      viewport.x + VIEWPORT_MARGIN,
      viewport.x + viewport.width - scaledWidth - VIEWPORT_MARGIN
    );
    const y = clamp(
      stageAnchor.y + stageAnchor.height + STRIP_OFFSET_Y,
      viewport.y + VIEWPORT_MARGIN,
      viewport.y + viewport.height - scaledHeight - VIEWPORT_MARGIN
    );
    call(entry.strip, 'size', width, height);
    call(entry.strip, 'scale', STRIP_SCALE, STRIP_SCALE);
    entry.strip.scaleX = STRIP_SCALE;
    entry.strip.scaleY = STRIP_SCALE;
    call(entry.strip, 'pos', x, y);
    entry.strip.visible = rows.length > 0;
  }

  function createTile(cardId: number, possible = false, tags: readonly string[] = []): UnknownRecord | null {
    const card = gameCardCatalog.resolve(cardId);
    const tile = createSprite(`xcVueMingpaiPreviewTag-${cardId}`);
    if (!tile) return null;
    tile.mouseEnabled = false;
    tile.mouseThrough = true;
    call(tile, 'size', TILE_WIDTH, TILE_HEIGHT);
    drawRoundedRect(tile, TILE_WIDTH, TILE_HEIGHT, 'rgba(255, 239, 207, 0.7)', '#392F22', 1, 4);

    const headHeight = Math.max(20, Math.round(TILE_HEIGHT * 0.53));
    const color = card.isRed ? '#E23E3E' : '#020000';
    const rank = card.rank || '?';
    const suit = card.suitGlyph || '';
    const head = createSprite('xcVueMingpaiPreviewRankSuit');
    const suitText = createText(suit, 20, color, 'left');
    const rankText = createText(rank, 20, color, 'left');
    if (head && suitText && rankText) {
      head.mouseEnabled = false;
      head.mouseThrough = true;
      const rankWidth = Math.max(1, Math.ceil(Number(rankText.textWidth) || 20 * Math.max(0.55, rank.length * 0.55)));
      const suitWidth = suit ? Math.max(1, Math.ceil(Number(suitText.textWidth) || 20)) : 0;
      const total = rankWidth + suitWidth;
      const fit = Math.min(1, TILE_WIDTH / total);
      call(head, 'size', total, headHeight + 4);
      head.scaleX = fit;
      call(head, 'pos', (TILE_WIDTH - total * fit) / 2, 0);
      call(suitText, 'size', suitWidth, headHeight + 4);
      call(suitText, 'pos', 0, 0);
      call(rankText, 'size', rankWidth, headHeight + 4);
      call(rankText, 'pos', suitWidth, 0);
      call(head, 'addChild', suitText);
      call(head, 'addChild', rankText);
      call(tile, 'addChild', head);
    }
    const shortName = createText((card.name || '?').slice(0, 2) || '?', 18, '#020000', 'center');
    if (shortName) {
      call(shortName, 'size', TILE_WIDTH, Math.max(1, TILE_HEIGHT - headHeight + 3));
      call(shortName, 'pos', 0, headHeight - 1);
      call(tile, 'addChild', shortName);
    }
    if (possible) {
      const markWidth = Math.max(9, Math.round(TILE_WIDTH * 0.27));
      const markHeight = Math.max(14, Math.round(TILE_HEIGHT * 0.34));
      const mark = createText('?', Math.max(13, Math.round(TILE_HEIGHT * 0.28)), POSSIBLE_MARK_COLOR, 'center', true);
      if (mark) {
        mark.name = 'xcVueMingpaiPossibleMark';
        call(mark, 'size', markWidth, markHeight);
        call(mark, 'pos', TILE_WIDTH - markWidth, TILE_HEIGHT - markHeight);
        call(tile, 'addChild', mark);
      }
      tile.alpha = POSSIBLE_ALPHA;
    }
    if (tags.length) {
      const label = createText(tags.join('·'), 10, '#FFF1A8', 'center', true);
      if (label) {
        label.name = `xcVueMingpaiPersistentTag-${cardId}`;
        label.stroke = 2;
        label.strokeColor = '#332411';
        call(label, 'size', TILE_WIDTH, 14);
        call(label, 'pos', 0, 0);
        call(tile, 'addChild', label);
      }
    }
    return tile;
  }

  function createEllipsisTile(): UnknownRecord | null {
    const tile = createSprite('xcVueMingpaiPreviewEllipsis');
    if (!tile) return null;
    tile.mouseEnabled = false;
    tile.mouseThrough = true;
    call(tile, 'size', TILE_WIDTH, TILE_HEIGHT);
    drawRoundedRect(tile, TILE_WIDTH, TILE_HEIGHT, 'rgba(255, 239, 207, 0.7)', '#392F22', 1, 4);
    const text = createText('…', 22, '#020000', 'center');
    if (text) {
      call(text, 'size', TILE_WIDTH, TILE_HEIGHT);
      call(text, 'pos', 0, -1);
      call(tile, 'addChild', text);
    }
    return tile;
  }

  function showPopup(entry: SeatStrip): void {
    const stage = readStage();
    const stageAnchor = anchorOnStage(entry);
    if (!stage || !stageAnchor
      || (!entry.cardIds.length && !entry.possibleGroups.length && !entry.zone4Rows.length)) {
      destroyPopup();
      return;
    }
    const viewport = readViewport(stage);
    const direction = chooseDirection(stageAnchor, viewport);
    const maxWidth = direction === 'right'
      ? viewport.x + viewport.width - VIEWPORT_MARGIN - stageAnchor.x - stageAnchor.width - POPUP_OFFSET
      : stageAnchor.x - viewport.x - VIEWPORT_MARGIN - POPUP_OFFSET;
    const cardWidth = Math.max(1, Math.round(OFFICIAL_CARD_BASE_WIDTH * POPUP_CARD_SCALE));
    const cardHeight = Math.max(1, Math.floor(OFFICIAL_CARD_BASE_HEIGHT * POPUP_CARD_SCALE));
    const available = Math.max(cardWidth + POPUP_PADDING * 2, maxWidth || 1600);
    const sections = [
      ...(entry.cardIds.length ? [{
        label: `确定牌（${entry.cardIds.length}）`,
        color: '#FFF3D0',
        cardIds: entry.cardIds,
        possible: false
      }] : []),
      ...entry.possibleGroups.map((group) => ({
        label: possibleGroupPopupLabel(group),
        color: '#C9C1B1',
        cardIds: possibleGroupPopupCardIds(group),
        possible: true
      })),
      ...zone4PopupSections(entry.zone4Rows)
    ].filter((section) => section.cardIds.length).map((section) => {
      const count = Math.max(1, section.cardIds.length);
      const step = count > 1
        ? Math.max(
          POPUP_MIN_OVERLAP_GAP,
          Math.min(cardWidth + POPUP_CARD_GAP, (available - POPUP_PADDING * 2 - cardWidth) / (count - 1))
        )
        : 0;
      const width = Math.min(available, POPUP_PADDING * 2 + cardWidth + step * (count - 1));
      const height = POPUP_TITLE_HEIGHT + cardHeight;
      return { ...section, step, width, height };
    });
    const width = Math.max(...sections.map((section) => section.width));
    const height = POPUP_PADDING * 2 + sections.reduce((sum, section) => sum + section.height, 0)
      + Math.max(0, sections.length - 1) * POPUP_SECTION_GAP;
    const teamMarkable = seatStateStore.getSnapshot().controlledSeatIds.includes(entry.seatId)
      && entry.seatId !== seatStateStore.getSnapshot().selfSeatId;
    const receivedMarks = recommendedBySeat.get(entry.seatId) ?? new Set<number>();
    const selectedMarks = selectedBySeat.get(entry.seatId) ?? new Set<number>();
    const popupZone4Sig = zone4PopupSections(entry.zone4Rows).map((section) => `${section.label}${section.cardIds.join(',')}`).join(';');
    const possibleSig = entry.possibleGroups
      .map((group) => `${group.key}:${possibleGroupPopupCardIds(group).join(',')}`)
      .join('|');
    const signature = `${entry.seatId}:${entry.cardIds.join(',')}|${possibleSig}:${[...receivedMarks].join(',')}:${[...selectedMarks].join(',')}:${teamMarkable}:${popupZone4Sig}:${Math.round(width)}:${direction}`;

    if (!popup || popupSignature !== signature) {
      destroyPopup();
      const created = createSprite('xcVueMingpaiCardList');
      if (!created) return;
      created.mouseEnabled = true;
      created.mouseThrough = false;
      created.zOrder = clampExtensionZOrder(EXTENSION_Z_BELOW_GAME_TIP);
      call(created, 'size', width, height);
      drawRoundedRect(created, width, height, 'rgba(29, 23, 18, 0.96)', '#C9A15D', 1, 6);
      const Event = readLayaEvent();
      call(created, 'on', Event?.ROLL_OVER ?? 'mouseover', created, clearHideTimer);
      call(created, 'on', Event?.ROLL_OUT ?? 'mouseout', created, scheduleHide);
      call(stage, 'addChild', created);
      let sectionTop = POPUP_PADDING;
      sections.forEach((section, sectionIndex) => {
        const top = sectionTop;
        const title = createText(section.label, 14, section.color, 'left');
        if (title) {
          call(title, 'size', Math.max(1, width - POPUP_PADDING * 2), POPUP_TITLE_HEIGHT);
          call(title, 'pos', POPUP_PADDING, top);
          call(created, 'addChild', title);
        }
        section.cardIds.forEach((cardId, index) => {
          const x = POPUP_PADDING + index * section.step;
          const y = top + POPUP_TITLE_HEIGHT;
          const cardIsPossible = section.possible
            || (section.possibleCardIds?.has(cardId) ?? false);
          const view = createOfficialCardView(
            created,
            cardId,
            OFFICIAL_CARD_BASE_WIDTH,
            OFFICIAL_CARD_BASE_HEIGHT,
            undefined,
            { x, y },
            POPUP_CARD_SCALE
          );
          if (view) {
            if (cardIsPossible) view.ui.alpha = POSSIBLE_ALPHA;
            view.holder.zOrder = 10 + index;
            view.ui.zOrder = 10 + index;
            popupCards.push(view);
          } else {
            const tile = createTile(cardId, cardIsPossible, entry.tagsByCardId.get(cardId) ?? []);
            if (tile) {
              const scaleX = cardWidth / TILE_WIDTH;
              const scaleY = cardHeight / TILE_HEIGHT;
              call(tile, 'scale', scaleX, scaleY);
              tile.scaleX = scaleX;
              tile.scaleY = scaleY;
              call(tile, 'pos', x, y);
              call(created, 'addChild', tile);
            }
          }
          if (section.label.startsWith('确定牌') && teamMarkable) {
            const recommended = receivedMarks.has(cardId);
            const marked = recommended || selectedMarks.has(cardId);
            if (marked) {
              // 描边：已选绿、队友推荐蓝。
              const outline = createSprite(`xcVueMingpaiTeamMarkOutline-${entry.seatId}-${cardId}`);
              if (outline) {
                outline.mouseEnabled = false;
                outline.mouseThrough = true;
                outline.zOrder = 1400 + index;
                call(outline, 'size', cardWidth, cardHeight);
                drawRoundedRect(outline, cardWidth, cardHeight, 'rgba(0,0,0,0)', recommended ? '#5AA7FF' : '#63F06E', 3, 4);
                call(outline, 'pos', x, y);
                call(created, 'addChild', outline);
              }
              const marker = createText(recommended ? '队友标记' : '已选择', 13, recommended ? '#5AA7FF' : '#63F06E', 'center', true);
              if (marker) {
                marker.name = `xcVueMingpaiTeamMarker-${cardId}`;
                marker.stroke = 2;
                marker.strokeColor = '#142B39';
                marker.zOrder = 1500 + index;
                call(marker, 'size', cardWidth, 18);
                call(marker, 'pos', x, y + cardHeight - 20);
                call(created, 'addChild', marker);
              }
            }
            const hit = createSprite(`xcVueMingpaiTeamMarkHit-${entry.seatId}-${cardId}`);
            if (hit) {
              hit.mouseEnabled = true;
              hit.mouseThrough = false;
              hit.hitTestPrior = true;
              hit.zOrder = 1800 + index;
              call(hit, 'size', cardWidth, cardHeight);
              call(hit, 'pos', x, y);
              call(hit.graphics, 'drawRect', 0, 0, cardWidth, cardHeight, 'rgba(0,0,0,0.01)', null, 0);
              call(hit, 'on', Event?.CLICK ?? 'click', hit, (pointer: UnknownRecord) => {
                call(pointer, 'stopPropagation');
                toggleTeammateMark(entry, cardId);
              });
              call(created, 'addChild', hit);
            }
          }
          if (cardIsPossible) {
            const mark = createText('?', 22, POSSIBLE_MARK_COLOR, 'center', true);
            if (mark) {
              mark.name = `xcVueMingpaiPopupPossibleMark-${cardId}`;
              mark.zOrder = 900 + index;
              call(mark, 'size', 18, 24);
              call(mark, 'pos', x + cardWidth - 22, y + cardHeight - 30);
              call(created, 'addChild', mark);
            }
          }
        });
        sectionTop += section.height + (sectionIndex < sections.length - 1 ? POPUP_SECTION_GAP : 0);
      });
      popup = created;
      popupSignature = signature;
    }
    popupSeatId = entry.seatId;
    const rawX = direction === 'right'
      ? stageAnchor.x + stageAnchor.width + POPUP_OFFSET
      : stageAnchor.x - width - POPUP_OFFSET;
    const x = clamp(rawX, viewport.x + VIEWPORT_MARGIN, viewport.x + viewport.width - width - VIEWPORT_MARGIN);
    const y = clamp(
      stageAnchor.y + (stageAnchor.height - height) / 2,
      viewport.y + VIEWPORT_MARGIN,
      viewport.y + viewport.height - height - VIEWPORT_MARGIN
    );
    call(popup, 'pos', x, y);
  }

  /**
   * 按座位快照重画小牌条。装备上的炁每秒刷一次并在绘制后还原，避免改掉游戏自己的标签。
   * 手牌上的心幽每次同步都写死在牌上，出牌重绘也不会闪掉。
   */
  function syncNow(): void {
    if (stopped) return;
    if (!configStore.get('display.seatUiEnabled')) {
      destroyAll();
      return;
    }
    if (previewSuspended || isNativeHudSuspended()) {
      if (isNativeHudSuspended() && !previewSuspended) {
        previewSuspended = true;
        runPostGamePreviewCleanup();
      } else {
        destroyAll();
      }
      return;
    }
    const snapshot = seatStateStore.getSnapshot();
    if (!snapshot.inGame) {
      destroyAll();
      return;
    }
    const currentScene = ensureScene();
    if (!currentScene) return;
    const seatUis = readSeatUis(currentScene);
    const engineSnapshot = mingpaiEngine?.getSnapshot();
    const now = Date.now();
    const refreshEquipmentTags = now - lastEquipmentTagRefreshAt >= 1000;
    if (refreshEquipmentTags) lastEquipmentTagRefreshAt = now;
    const activeSeatIds = new Set<number>();
    for (const seat of snapshot.seats) {
      const seatUi = seatUis.get(seat.seatId);
      if (seatUi && refreshEquipmentTags) {
        refreshNativeCardTags(readEquipmentCardUis(seatUi), ['炁'], false);
      }
      if (seatUi) {
        const handUis = readHandCardUis(seatUi);
        const equipUis = readEquipmentCardUis(seatUi);
        handUis.forEach((cardUi) => installXinyouTagHook(cardUi));
        equipUis.forEach((cardUi) => installXinyouTagHook(cardUi));
        refreshNativeCardTags(equipUis, ['心幽'], true);
        const tanquePoint = seat.seatId === snapshot.selfSeatId ? readTanquePoint(seatUi) : 0;
        const handLabel = (card: UnknownRecord) => tanqueDiffLabel(readCardNumber(card), tanquePoint);
        refreshNativeCardTags(handUis, ['心幽', '椒遇'], true, handLabel, seat.seatId);
        refreshNativeCardTags(readShownHandEntries(asRecord(seatUi.seat), seatUi), ['心幽', '椒遇'], true, undefined, seat.seatId);
      }
      if (seat.seatId === snapshot.selfSeatId) {
        // 本机手牌仍由游戏原生组件承载选牌/技能交互，不能隐藏它。
        const existing = strips.get(seat.seatId);
        if (existing?.nativeSprite) restoreNativeSprite(existing);
        continue;
      }
      const anchor = seatUi ? readAnchorRect(seatUi, seatUi) : null;
      syncShownHandCards(seat.seatId, seatUi, engineSnapshot);
      // 明牌条只画引擎手牌区，不跟场景里的过期列表互相覆盖。
      const equipmentIds = new Set(
        (seat.equipmentCards ?? []).map((card) => card.cardId).filter((cardId) => cardId > 0)
      );
      const currentKnownIds = new Set(seat.knownCards.map((card) => card.cardId));
      const zone4RowsAll = getZone4Rows(seat.seatId);
      const zone4Partition = partitionZone4RowsForStrip(zone4RowsAll);
      const skillZoneCardIds = new Set(zone4Partition.stripExcludeCardIds);
      const engineHandIds = (mingpaiEngine?.getHandCardIds(seat.seatId) ?? [])
        .filter((cardId) => cardId > 0 && !equipmentIds.has(cardId) && !skillZoneCardIds.has(cardId));
      const engineHandLocation = (cardId: number): { seatId: number; zone: number } | null => {
        const location = engineSnapshot?.records.find((record) => record.cardId === cardId)?.location;
        if (!location) return null;
        return { seatId: location.seatId, zone: location.zone };
      };
      const isCardInThisHand = (cardId: number): boolean => {
        const location = engineHandLocation(cardId);
        if (!location) return true;
        return location.zone === HAND_ZONE && location.seatId === seat.seatId;
      };
      let cardIds = engineHandIds
        .filter((cardId) => currentKnownIds.has(cardId) && isCardInThisHand(cardId));
      for (const known of seat.knownCards) {
        const cardId = known.cardId;
        if (cardId <= 0 || equipmentIds.has(cardId) || skillZoneCardIds.has(cardId)) continue;
        if (!currentKnownIds.has(cardId) || cardIds.includes(cardId)) continue;
        if (!isCardInThisHand(cardId)) continue;
        if (!engineHandIds.includes(cardId)) cardIds.push(cardId);
      }
      const engineTagsByCardId = new Map((engineSnapshot?.records ?? [])
        .filter((record) => record.persistentTags.length)
        .map((record) => [record.cardId, record.persistentTags] as const));
      const tagsByCardId = new Map(cardIds.flatMap((cardId) => {
        const sceneTags = seat.knownCards.find((card) => card.cardId === cardId)?.tags ?? [];
        const engineTags = engineTagsByCardId.get(cardId) ?? [];
        const tags = visibleMingpaiTags([...sceneTags, ...engineTags]);
        return tags.length ? [[cardId, tags] as const] : [];
      }));
      // 郭照：判定牌一律明牌，她拿到的牌牌面是确定的，手上不该再挂可能牌。
      let popupPossibleGroups = buildPopupPossibleGroups(
        seat,
        cardIds,
        engineHandIds,
        equipmentIds,
        skillZoneCardIds
      );
      if (seatUi && seatIsGuozhao(seatUi) && popupPossibleGroups.length) {
        popupPossibleGroups.forEach((group) => {
          group.candidateCardIds.forEach((cardId) => {
            if (cardId > 0 && !cardIds.includes(cardId)) cardIds.push(cardId);
          });
        });
        popupPossibleGroups = [];
      }
      const keptCardIds = [...cardIds];
      for (const merged of zone4Partition.mergeKnownBySpell) {
        const tag = ZONE4_STRIP_ROWS_ENABLED ? zone4HandSourceTag(merged.spellId) : null;
        for (const cardId of merged.cardIds) {
          if (!cardIds.includes(cardId)) cardIds.push(cardId);
          if (!tag) continue;
          const prev = tagsByCardId.get(cardId) ?? [];
          tagsByCardId.set(cardId, visibleMingpaiTags([...prev, tag]));
        }
      }
      const skillCardIds = stripBlockedSkillCardIds(zone4CardIds(zone4RowsAll), keptCardIds);
      const cardName = (cardId: number) => gameCardCatalog.resolve(cardId).name;
      popupPossibleGroups = popupPossibleGroups.filter((group) => (
        isNamedPossibleGroup(group, cardName, skillCardIds)
      ));
      const zone4Rows = zone4Partition.stripRows;
      const stripTiles = mingpaiStripTiles({
        knownCardIds: cardIds,
        possibleGroups: popupPossibleGroups,
        skillCardIds,
        cardName
      });
      const existing = strips.get(seat.seatId);
      if (!seatUi || !anchor || stripTiles.length === 0) {
        if (existing) destroyStrip(existing);
        continue;
      }
      // 游戏自己在显示这个座位的明牌时让位给官方框：不隐藏它，也不画自己的小牌条。
      if (gameShowsOwnMingpai(seatUi)) {
        if (existing) destroyStrip(existing);
        continue;
      }
      const entry = existing ?? createStrip(seat.seatId, seatUi);
      if (!entry) continue;
      hideNativeSprite(entry, seatUi);
      renderStrip(entry, cardIds, popupPossibleGroups, tagsByCardId, zone4Rows, skillCardIds, anchor);
      activeSeatIds.add(seat.seatId);
      if (popupSeatId === seat.seatId) showPopup(entry);
    }
    [...strips.values()]
      .filter((entry) => !activeSeatIds.has(entry.seatId))
      .forEach(destroyStrip);
  }

  const bridge = asRecord((globalThis as UnknownRecord).__XIAOCHAO_ENGINEERING__);
  if (bridge) bridge.mingpaiNativePerf = mingpaiPerf;

  function sync(): void {
    if (stopped || syncing) return;
    syncing = true;
    const t0 = now();
    try {
      syncNow();
    } finally {
      recordNativeSync(now() - t0);
      syncing = false;
    }
  }

  function scheduleSync(): void {
    if (stopped || syncTimer) return;
    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      sync();
    }, SYNC_DEBOUNCE_MS);
  }

  function toggleTeammateMark(entry: SeatStrip, cardId: number): void {
    const snapshot = seatStateStore.getSnapshot();
    if (!snapshot.controlledSeatIds.includes(entry.seatId) || entry.seatId === snapshot.selfSeatId) return;
    const selected = selectedBySeat.get(entry.seatId) ?? new Set<number>();
    if (selected.has(cardId)) selected.delete(cardId);
    else {
      // 默认识别上限 RecCardLimit=1；游戏原生有配置时读取配置上限。
      const limit = readTeammateMarkLimit(scene);
      while (selected.size >= limit) selected.delete(selected.values().next().value as number);
      selected.add(cardId);
    }
    if (selected.size) selectedBySeat.set(entry.seatId, selected);
    else selectedBySeat.delete(entry.seatId);
    showPopup(entry);
    const previous = markTimers.get(entry.seatId);
    if (previous) window.clearTimeout(previous);
    const timer = window.setTimeout(() => {
      markTimers.delete(entry.seatId);
      const latest = selectedBySeat.get(entry.seatId) ?? new Set<number>();
      const stillKnown = new Set(seatStateStore.getSnapshot().seats
        .find((seat) => seat.seatId === entry.seatId)?.knownCards.map((card) => card.cardId) ?? []);
      const ids = [...latest].filter((id) => stillKnown.has(id));
      if (!ids.length) return;
      const currentScene = asRecord(locateGameScene(window));
      const manager = asRecord(currentScene?.Manager ?? currentScene?.manager);
      const send = manager?.SendMsgQuickChatCardTagReq;
      if (typeof send !== 'function' || !canShowTeammateMarks()) return;
      try {
        recommendedBySeat.set(entry.seatId, new Set(ids));
        send.call(manager, entry.seatId, ids);
        selectedBySeat.delete(entry.seatId);
        showPopup(entry);
      } catch (error) {
        console.warn('[明牌] 队友手牌标记发送失败', error);
      }
    }, 100);
    markTimers.set(entry.seatId, timer);
  }

  /**
   * 游戏重绘手牌时会清空 tagArr1 再调 UpdateTag。
   * 在绘制前把心幽和椒遇写回去，标签就不会先消失再出现。
   * 同一个原型只 patch 一次，避免反复遍历原型链。
   */
  function installXinyouTagHook(rawUi: unknown): void {
    const cardUi = asRecord(rawUi);
    if (!cardUi) return;
    let prototype = Object.getPrototypeOf(cardUi) as UnknownRecord | null;
    while (prototype && !Object.prototype.hasOwnProperty.call(prototype, 'UpdateTag')) {
      prototype = Object.getPrototypeOf(prototype) as UnknownRecord | null;
    }
    if (!prototype || patchedTagPrototypes.has(prototype)) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'UpdateTag');
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as (this: unknown, ...args: unknown[]) => unknown;
    const patched = function (this: UnknownRecord, ...args: unknown[]) {
      stampPersistentCardTags(this);
      return original.apply(this, args);
    };
    try {
      Object.defineProperty(prototype, 'UpdateTag', { ...descriptor, value: patched });
      patchedTagPrototypes.add(prototype);
      tagMethodPatches.push({ prototype, descriptor });
    } catch {
      // 原型不可写时仍靠轮询把标签写回。
    }
  }

  /** 心幽、椒遇，以及还在手里的来源短名，写进游戏绘制用的数组。 */
  function stampPersistentCardTags(cardUi: UnknownRecord): void {
    const card = asRecord(cardUi.Card) ?? asRecord(cardUi.card);
    if (!card) return;
    const cardId = Number(card.cardId ?? card.cardID ?? card.CardId ?? card.CardID ?? card.id ?? card.ID ?? card.key);
    if (!Number.isInteger(cardId) || cardId <= 0) return;
    const persistent = mingpaiEngine?.getPersistentTags(cardId) ?? [];
    const labels = persistent.filter((label) => label === '心幽' || label === '椒遇' || label.startsWith('['));
    const tagKey = Object.prototype.hasOwnProperty.call(card, 'tagArr1') ? 'tagArr1' : 'TagArr1';
    const tags = Array.isArray(card[tagKey]) ? (card[tagKey] as unknown[]).map(String) : [];
    const kept = tags.filter((tag) => (tag !== '心幽' && tag !== '椒遇') || labels.includes(tag));
    const missing = labels.filter((label) => !kept.includes(label));
    if (!missing.length && kept.length === tags.length) return;
    card[tagKey] = [...kept, ...missing];
  }

  /** 引擎还没记下位置时，按这张牌仍在手里处理。已经离开手牌区就不再画来源短名。 */
  function cardStillInHand(cardId: number, seatId?: number): boolean {
    const location = mingpaiEngine?.getSnapshot().records.find((record) => record.cardId === cardId)?.location;
    if (!location) return true;
    if (location.zone !== HAND_ZONE) return false;
    return seatId === undefined || location.seatId === seatId;
  }

  /** 牌已经离开这手手牌。只清来源短名，不再调用 AddCardTag / UpdateTag，避免把手牌控件重新挂回去。 */

  const tanquePointBySeat = new Map<number, number>();

  /** 弹雀对照点数在自己座位上，没有或已经清掉时是 0。 */
  function readTanquePoint(seatUi: UnknownRecord): number {
    const seat = asRecord(seatUi.seat) ?? seatUi;
    const seatId = Number(seat.Index ?? seat.SeatID ?? seat.seatId ?? seatUi.seatId);
    const reader = typeof seat.GetStateValue === 'function'
      ? seat
      : typeof seatUi.GetStateValue === 'function' ? seatUi : null;
    if (reader) {
      const value = Number((reader.GetStateValue as (stateId: number) => unknown)(TANQUE_STATE_ID));
      return Number.isFinite(value) && value > 0 ? value : 0;
    }
    return tanquePointBySeat.get(seatId) ?? 0;
  }

  function readCardNumber(card: UnknownRecord): number {
    return Number(card.CardNumber ?? card.cardNumber);
  }

  /** 把持续标签刷回原生卡牌 UI。keepOnCard 时写在牌上，直到调用方去掉标签。 */
  function refreshNativeCardTags(
    cardUis: unknown[],
    labels: readonly string[],
    keepOnCard: boolean,
    dynamicLabel?: (card: UnknownRecord) => string | null,
    handSeatId?: number
  ): void {
    const enabled = configStore.get('display.cardLabelsEnabled');
    for (const rawUi of cardUis) {
      const cardUi = asRecord(rawUi);
      const card = asRecord(cardUi?.Card) ?? asRecord(cardUi?.card) ?? cardUi;
      if (!cardUi || !card) continue;
      const cardId = Number(card.cardId ?? card.cardID ?? card.CardId ?? card.CardID ?? card.id ?? card.ID ?? card.key);
      if (!Number.isInteger(cardId) || cardId <= 0) continue;
      const persistent = mingpaiEngine?.getPersistentTags(cardId) ?? [];
      const sourceLabels = persistent.filter((label) => label.startsWith('[') && !label.startsWith('[弹雀]'));
      const dynamic = enabled && dynamicLabel ? dynamicLabel(card) ?? '' : '';
      const extra = enabled
        ? [...labels.filter((label) => persistent.includes(label)), ...sourceLabels, ...(dynamic ? [dynamic] : [])]
        : [];
      const tagKey = Object.prototype.hasOwnProperty.call(card, 'tagArr1') ? 'tagArr1' : 'TagArr1';
      const originalTags = card[tagKey];
      const tags = Array.isArray(originalTags) ? originalTags.map(String) : [];
      const managed = new Set<string>([...labels, ...tags.filter((tag) => tag.startsWith('['))]);
      const nextTags = [...new Set([...tags.filter((tag) => !managed.has(tag)), ...extra])];
      if (!extra.length && !tags.some((tag) => managed.has(tag))) continue;
      const nextTagsKey = nextTags.join('\n');
      const cache = cardTagCache.get(card);
      if (cache && cache.cardId === cardId && cache.tags === nextTagsKey && cache.keepOnCard === keepOnCard) continue;
      try {
        call(cardUi, 'AddCardTag');
        card[tagKey] = nextTags;
        call(cardUi, 'UpdateTag');
        cardTagCache.set(card, { cardId, tags: nextTagsKey, keepOnCard });
      } catch {
        // 部分游戏版本的卡牌对象不可写，明牌预览仍会展示持续标签。
      } finally {
        if (keepOnCard) continue;
        if (originalTags === undefined) delete card[tagKey];
        else card[tagKey] = originalTags;
      }
    }
  }

  function readEquipmentCardUis(seatUi: UnknownRecord): unknown[] {
    const container = asRecord(seatUi.cardContainer);
    return [
      ...readArray(container, ['equipCardUis', 'equipCardUIs']),
      ...readArray(seatUi, ['equipCardUis', 'equipCardUIs'])
    ];
  }

  /**
   * 技能展示别人的手牌时，网页端把牌放进 HandShowCards，微端把卡号写在 HandShowCardIDs。
   * 移牌协议不一定带卡号，这些牌才补进手牌区。
   * 观星会把牌堆顶的牌短暂放进展示区，牌位图里已经有位置、且不在这名角色手上的牌不改位置。
   * 离开展示列表时再移出。
   */
  function syncShownHandCards(
    seatId: number,
    seatUi: UnknownRecord | undefined,
    engineSnapshot: ReturnType<MingpaiEngine['getSnapshot']> | undefined
  ): void {
    if (!mingpaiEngine || !seatUi) return;
    const seat = asRecord(seatUi.seat);
    const shown = readShownHandEntries(seat, seatUi);
    const next = new Set(shown.map(readCardId).filter((cardId) => cardId > 0));
    const handCount = readSeatHandCardCount(seat, seatUi) ?? Number.NaN;
    const liveHand = new Set(readArray(seat, ['HandCards', 'handCards']).map(readCardId).filter((cardId) => cardId > 0));
    const equipmentIds = new Set([
      ...readArray(seatUi, ['equipCardUis', 'equipCardUIs']),
      ...readArray(asRecord(seatUi.cardContainer), ['equipCardUis', 'equipCardUIs'])
    ].map(readCardId).filter((cardId) => cardId > 0));
    const seatSnapshot = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === seatId);
    for (const card of seatSnapshot?.equipmentCards ?? []) {
      if (card.cardId > 0) equipmentIds.add(card.cardId);
    }
    // 技能看牌只进 HandShowCards，不进 HandCards。只有两边卡号有交集时，才用实时手牌判断哪张已经离开。
    if (handCount === 0) next.clear();
    else if (Number.isInteger(handCount) && handCount > 0 && next.size > handCount) {
      // 卡号列表只往后加。超出手牌数时留下最新的几张，旧牌号不再记进明牌。
      const current = [...next].slice(-handCount);
      next.clear();
      current.forEach((cardId) => next.add(cardId));
    }
    const placedOutsideThisHand = (cardId: number) => {
      const location = engineSnapshot?.records.find((record) => record.cardId === cardId)?.location;
      if (!location) return false;
      return location.zone !== HAND_ZONE || location.seatId !== seatId;
    };
    const liveHandConfirmsMembership = [...next].some((cardId) => liveHand.has(cardId));
    for (const cardId of [...next]) {
      if (equipmentIds.has(cardId) || placedOutsideThisHand(cardId)) {
        next.delete(cardId);
        continue;
      }
      if (
        liveHandConfirmsMembership
        && Number.isFinite(handCount)
        && liveHand.size === handCount
        && !liveHand.has(cardId)
      ) next.delete(cardId);
    }
    const officialHandIds = [...next];
    const previous = officialShownBySeat.get(seatId) ?? new Set<number>();
    for (const cardId of officialHandIds) {
      if (previous.has(cardId)) continue;
      mingpaiEngine.observeKnownHandCard(cardId, seatId, []);
    }
    // 离开官方公开手牌列表的牌只回收普通标签，不推断它去了哪里。
    mingpaiEngine.syncOfficialHand(seatId, officialHandIds);
    const kept = new Set(officialHandIds);
    if (kept.size) officialShownBySeat.set(seatId, kept);
    else officialShownBySeat.delete(seatId);
  }

  function readHandCardUis(seatUi: UnknownRecord): unknown[] {
    const container = asRecord(seatUi.cardContainer);
    return readArray(container, ['cardUis', 'cardUIs', 'handCardUis', 'handCardUIs']);
  }

  function onGameEvent(event: import('../../runtime/game-event-bus.ts').GameEvent): void {
    if (event.type === 'game-ended') {
      previewSuspended = true;
      markTimers.forEach((timerId) => window.clearTimeout(timerId));
      markTimers.clear();
      releaseSceneNativeHandGuards(asRecord(locateGameScene(window)));
      runPostGamePreviewCleanup();
      scheduleMingpaiPostGameCleanup();
      return;
    }
    if (event.type === 'game-started') {
      cancelMingpaiPostGameCleanup();
      previewSuspended = false;
      recommendedBySeat.clear();
      selectedBySeat.clear();
      officialShownBySeat.clear();
      tanquePointBySeat.clear();
      return;
    }
    if (event.type === 'game-reconnected') {
      // 重连后牌位图整副重建，队友标记与展示列表的缓存都要跟着丢。
      recommendedBySeat.clear();
      selectedBySeat.clear();
      officialShownBySeat.clear();
      tanquePointBySeat.clear();
      markTimers.forEach((timerId) => window.clearTimeout(timerId));
      markTimers.clear();
      return;
    }
    if (event.type === 'seat-state-changed' && event.stateId === TANQUE_STATE_ID) {
      if (event.value > 0) tanquePointBySeat.set(event.seatId, event.value);
      else tanquePointBySeat.delete(event.seatId);
      return;
    }
    if (event.type !== 'friend-hand-tags-updated') return;
    recommendedBySeat.set(event.seatId, new Set(event.cardIds));
    const entry = strips.get(event.seatId);
    if (entry && popupSeatId === event.seatId) showPopup(entry);
  }

  let sessionInGame = seatStateStore.getSnapshot().inGame;
  const stopSession = seatStateStore.subscribe((snapshot) => {
    if (snapshot.inGame) {
      sessionInGame = true;
      return;
    }
    if (!sessionInGame) return;
    sessionInGame = false;
    previewSuspended = true;
    releaseSceneNativeHandGuards(asRecord(locateGameScene(window)));
    runPostGamePreviewCleanup();
    scheduleMingpaiPostGameCleanup();
  });

  function runPostGamePreviewCleanup(): void {
    recommendedBySeat.clear();
    selectedBySeat.clear();
    officialShownBySeat.clear();
    tanquePointBySeat.clear();
    destroyAll();
  }
  const unregisterPostGameCleanup = registerMingpaiPostGameCleanup(runPostGamePreviewCleanup);
  const unregisterHudTeardown = registerNativeHudPostGameTeardown(runPostGamePreviewCleanup);

  function adjustPollInterval() {
    const inGame = seatStateStore.getSnapshot().inGame && !previewSuspended && !isNativeHudSuspended();
    const nextMs = inGame ? POLL_INTERVAL_MS : POLL_INTERVAL_OUT_OF_GAME_MS;
    if (pollTimer && pollIntervalMs === nextMs) return;
    if (pollTimer) window.clearInterval(pollTimer);
    pollIntervalMs = nextMs;
    pollTimer = window.setInterval(scheduleSync, pollIntervalMs);
  }
  let pollIntervalMs = POLL_INTERVAL_OUT_OF_GAME_MS;

  const stopSeatState = seatStateStore.subscribe(scheduleSync);
  const stopMingpai = mingpaiEngine?.subscribe(scheduleSync);
  const stopGameEvents = gameEvents?.subscribe(onGameEvent);
  const stopConfig = configStore.subscribe('display.seatUiEnabled', scheduleSync);
  pollTimer = window.setInterval(() => {
    adjustPollInterval();
    scheduleSync();
  }, pollIntervalMs);
  sync();

  return () => {
    stopped = true;
    if (bridge) delete (bridge as Record<string, unknown>).mingpaiNativePerf;
    cancelMingpaiPostGameCleanup();
    unregisterPostGameCleanup();
    unregisterHudTeardown();
    if (pollTimer) window.clearInterval(pollTimer);
    pollTimer = 0;
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = 0;
    stopSession();
    stopSeatState();
    stopMingpai?.();
    stopGameEvents?.();
    markTimers.forEach((timerId) => window.clearTimeout(timerId));
    markTimers.clear();
    stopConfig();
    for (const patch of tagMethodPatches) {
      const current = Object.getOwnPropertyDescriptor(patch.prototype, 'UpdateTag');
      if (!current) continue;
      try { Object.defineProperty(patch.prototype, 'UpdateTag', patch.descriptor); } catch { /* 游戏退出时对象可能已冻结。 */ }
    }
    tagMethodPatches.length = 0;
    cardTagCache = new WeakMap();
    destroyAll();
  };
}

/**
 * 这个座位是不是郭照。
 * 郭照的判定牌是明牌，拿到的牌她的选定颜色在牌局里也是公开的，
 * 所以她手上不该出现可能牌。
 */
export function seatIsGuozhao(seatUi: UnknownRecord): boolean {
  const seat = asRecord(seatUi.seat);
  if (!seat) return false;
  for (const key of ['General', 'general', 'General2', 'general2']) {
    const general = asRecord(seat[key]);
    if (!general) continue;
    for (const nameKey of ['cardName', 'specifyName', 'trueSpecifyName', 'Name', 'name']) {
      const name = general[nameKey];
      if (typeof name === 'string' && name.includes('郭照')) return true;
    }
  }
  return false;
}

/** 游戏自己是否正在显示这个座位的明牌。排位队友手牌、斗地主明牌都是这种。 */function gameShowsOwnMingpai(seatUi: UnknownRecord): boolean {
  const manager = asRecord(seatUi.otherTopManager) ?? asRecord(seatUi.topManager);
  const sprite = asRecord(manager?.handCardSpr);
  if (!sprite || sprite.destroyed || !sprite.visible) return false;
  const seat = asRecord(seatUi.seat);
  return readShownHandEntries(seat, seatUi).some((entry) => readCardId(entry) > 0);
}

/** 不改写 handCardSpr：部分客户端手牌与装备同容器，强制隐藏会导致装备区消失。 */
function hideNativeSprite(_entry: SeatStrip, _seatUi: UnknownRecord): void {
}

function releaseNativeHandSpriteGuard(sprite: UnknownRecord | null): void {
  const guard = asRecord(sprite?.[NATIVE_GUARD_KEY]) as {
    ownDescriptor?: PropertyDescriptor; requestedVisible: boolean; write(value: boolean): void;
  } | null;
  if (!sprite || !guard) return;
  try {
    if (guard.ownDescriptor) Object.defineProperty(sprite, 'visible', guard.ownDescriptor);
    else delete sprite.visible;
    delete sprite[NATIVE_GUARD_KEY];
    guard.write(guard.requestedVisible);
    if ('_visible' in sprite) sprite._visible = guard.requestedVisible;
    call(sprite, 'OnUpdateCard');
  } catch {
    // 场景切换时节点可能已销毁。
  }
}

function releaseSceneNativeHandGuards(gameScene: UnknownRecord | null): void {
  const seatUis = gameScene?.seatContainer as { seatUIs?: unknown[] } | undefined;
  if (!Array.isArray(seatUis)) return;
  for (const rawSeatUI of seatUis) {
    const seatUi = asRecord(rawSeatUI);
    if (!seatUi) continue;
    const manager = asRecord(seatUi.otherTopManager) ?? asRecord(seatUi.topManager);
    releaseNativeHandSpriteGuard(asRecord(manager?.handCardSpr));
  }
}

function restoreNativeSprite(entry: SeatStrip): void {
  const sprite = entry.nativeSprite;
  entry.nativeSprite = null;
  releaseNativeHandSpriteGuard(sprite);
  if (!sprite) return;
  try {
    call(sprite, 'OnUpdateCard');
  } catch {
    // 场景切换时组件可能已销毁。
  }
}

function readSeatUis(scene: UnknownRecord): Map<number, UnknownRecord> {
  const result = new Map<number, UnknownRecord>();
  const seatUis = asRecord(scene.seatContainer)?.seatUIs;
  for (const value of Array.isArray(seatUis) ? seatUis : []) {
    const seatUi = asRecord(value);
    const seat = asRecord(seatUi?.seat);
    const seatId = Number(seat?.index ?? seat?.Index ?? seatUi?.seatID);
    if (seatUi && Number.isInteger(seatId)) result.set(seatId, seatUi);
  }
  return result;
}

/** 以武将牌（缺失时座位头像 / 座位）为锚点，换算到小牌条根节点坐标。 */
function readAnchorRect(seatUi: UnknownRecord, root: UnknownRecord): Rect | null {
  const avatar = asRecord(seatUi.seatAvatar);
  for (const node of [asRecord(avatar?.generalCard), avatar, seatUi]) {
    if (!node) continue;
    const local = readNodeRect(node);
    if (!local) continue;
    const topLeft = toRootPoint(node, root, local.x, local.y);
    const bottomRight = toRootPoint(node, root, local.x + local.width, local.y + local.height);
    if (!topLeft || !bottomRight) continue;
    return {
      x: Math.min(topLeft.x, bottomRight.x),
      y: Math.min(topLeft.y, bottomRight.y),
      width: Math.abs(bottomRight.x - topLeft.x),
      height: Math.abs(bottomRight.y - topLeft.y)
    };
  }
  return null;
}

function readNodeRect(node: UnknownRecord): Rect | null {
  if (node.destroyed) return null;
  const accept = (value: unknown): Rect | null => {
    const record = asRecord(value);
    const width = Math.max(0, Number(record?.width) || 0);
    const height = Math.max(0, Number(record?.height) || 0);
    if (width < 40 || height < 50) return null;
    return { x: Number(record?.x) || 0, y: Number(record?.y) || 0, width, height };
  };
  const fromShowRect = accept(node.showRect);
  if (fromShowRect) return fromShowRect;
  try {
    const fromBounds = accept(call(node, 'getSelfBounds'));
    if (fromBounds) return fromBounds;
  } catch { /* 不同版本方法可能缺失。 */ }
  const width = Math.max(0, Number(node.width) || Number(node.ScaledWidth) || 0);
  const height = Math.max(0, Number(node.height) || Number(node.ScaledHeight) || 0);
  return width >= 40 && height >= 50 ? { x: 0, y: 0, width, height } : null;
}

function readViewport(root: UnknownRecord | null): Rect {
  const laya = asRecord((globalThis as UnknownRecord).Laya);
  const stage = asRecord(laya?.stage);
  const stageWidth = Math.max(1, Number(stage?.width) || Number(root?.width) || 1600);
  const stageHeight = Math.max(1, Number(stage?.height) || Number(root?.height) || 900);
  if (stage && root) {
    const topLeft = toRootPoint(stage, root, 0, 0);
    const bottomRight = toRootPoint(stage, root, stageWidth, stageHeight);
    if (topLeft && bottomRight) {
      return {
        x: Math.min(topLeft.x, bottomRight.x),
        y: Math.min(topLeft.y, bottomRight.y),
        width: Math.max(1, Math.abs(bottomRight.x - topLeft.x)),
        height: Math.max(1, Math.abs(bottomRight.y - topLeft.y))
      };
    }
  }
  return { x: 0, y: 0, width: stageWidth, height: stageHeight };
}

function toRootPoint(node: UnknownRecord, root: UnknownRecord, x: number, y: number): { x: number; y: number } | null {
  try {
    const Point = asRecord((globalThis as UnknownRecord).Laya)?.Point as (new (x: number, y: number) => object) | undefined;
    const makePoint = (px: number, py: number) => (typeof Point === 'function' ? new Point(px, py) : { x: px, y: py });
    const global = typeof node.localToGlobal === 'function'
      ? asRecord((node.localToGlobal as Function).call(node, makePoint(x, y)))
      : { x, y };
    if (!global) return null;
    const local = typeof root.globalToLocal === 'function'
      ? asRecord((root.globalToLocal as Function).call(root, makePoint(Number(global.x), Number(global.y))))
      : global;
    const px = Number(local?.x);
    const py = Number(local?.y);
    return Number.isFinite(px) && Number.isFinite(py) ? { x: px, y: py } : null;
  } catch {
    return null;
  }
}

function chooseDirection(anchor: Rect, viewport: Rect): 'left' | 'right' {
  const rightSpace = viewport.x + viewport.width - VIEWPORT_MARGIN - anchor.x - anchor.width;
  const leftSpace = anchor.x - viewport.x - VIEWPORT_MARGIN;
  return rightSpace >= leftSpace ? 'right' : 'left';
}

function createSprite(name: string): UnknownRecord | null {
  const Sprite = asRecord((globalThis as UnknownRecord).Laya)?.Sprite;
  if (typeof Sprite !== 'function') return null;
  const sprite = asRecord(new (Sprite as unknown as new () => object)());
  if (sprite) sprite.name = name;
  return sprite;
}

function createText(
  text: string,
  fontSize: number,
  color: string,
  align: 'left' | 'center',
  bold = false
): UnknownRecord | null {
  const Text = asRecord((globalThis as UnknownRecord).Laya)?.Text;
  if (typeof Text !== 'function') return null;
  const node = asRecord(new (Text as unknown as new () => object)());
  if (!node) return null;
  node.text = text;
  node.font = GAME_FONT;
  node.fontSize = fontSize;
  node.color = color;
  node.stroke = 0;
  node.align = align;
  node.valign = 'middle';
  node.bold = bold;
  node.mouseEnabled = false;
  return node;
}

function drawRoundedRect(
  target: UnknownRecord,
  width: number,
  height: number,
  fill: string,
  stroke: string,
  lineWidth: number,
  radius: number
): void {
  const graphics = asRecord(target.graphics);
  if (!graphics) return;
  const r = Math.min(radius, width / 2, height / 2);
  call(graphics, 'clear');
  try {
    call(graphics, 'drawPath', 0, 0, [
      ['moveTo', r, 0],
      ['arcTo', width, 0, width, height, r],
      ['arcTo', width, height, 0, height, r],
      ['arcTo', 0, height, 0, 0, r],
      ['arcTo', 0, 0, r, 0, r],
      ['closePath']
    ], { fillStyle: fill }, { strokeStyle: stroke, lineWidth });
  } catch {
    call(graphics, 'drawRect', 0, 0, width, height, fill, stroke, lineWidth);
  }
}

function destroyNode(node: UnknownRecord): void {
  try {
    call(node, 'removeSelf');
    if (typeof node.addDrawChild === 'function') return;
    call(node, 'destroy', false);
  } catch {
    // 场景切换时节点可能已销毁。
  }
}

function readChildren(node: UnknownRecord): UnknownRecord[] {
  const children = node._children;
  return Array.isArray(children) ? children.map(asRecord).filter(Boolean) as UnknownRecord[] : [];
}

function findDescriptor(target: object | null, key: string): PropertyDescriptor | null {
  for (let current = target; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
  }
  return null;
}

function readLayaEvent(): UnknownRecord | null {
  return asRecord(asRecord((globalThis as UnknownRecord).Laya)?.Event);
}

/** 技能标记区（zone 4）的行在弹层里单独分栏，标题色按旧版。 */
type Zone4PopupSection = {
  label: string;
  color: string;
  cardIds: number[];
  possible: boolean;
  possibleCardIds?: ReadonlySet<number>;
};

function zone4PopupSections(rows: readonly Zone4Row[]): Zone4PopupSection[] {
  const sections: Zone4PopupSection[] = [];
  for (const row of rows.filter(zone4RowHasCards)) {
    if (row.hiddenPlacementCount > 0) {
      sections.push({
        label: `${row.label}（${row.hiddenPlacementCount}张）`,
        color: '#C9C1B1',
        cardIds: Array.from({ length: row.hiddenPlacementCount }, () => 0),
        possible: true
      });
      continue;
    }
    if (!row.cardIds.length) continue;
    sections.push({
      label: `${row.label}（${row.cardIds.length}张）`,
      color: '#E6E7AF',
      cardIds: row.cardIds,
      possible: false,
      possibleCardIds: new Set(row.possibleCardIds)
    });
  }
  return sections;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), value));
}

function readTeammateMarkLimit(scene: UnknownRecord | null): number {
  const seatUis = asRecord(scene?.seatContainer)?.seatUIs;
  for (const rawSeat of Array.isArray(seatUis) ? seatUis : []) {
    const seat = asRecord(rawSeat);
    const host = asRecord(seat?.nativeHost) ?? asRecord(seat?.propTip) ?? asRecord(seat?.proptip);
    const params = asRecord(asRecord(host?.proptip)?.paramVo)
      ?? asRecord(asRecord(host?.proptip)?.paramVO)
      ?? asRecord(host?.paramVo);
    const limit = Number(params?.RecCardLimit);
    if (Number.isFinite(limit) && limit > 0) return Math.max(1, Math.min(20, Math.floor(limit)));
  }
  return 1;
}

function canShowTeammateMarks(): boolean {
  const globals = globalThis as UnknownRecord;
  const runtime = asRecord(globals.zy) ?? asRecord(globals.laya);
  const getClass = runtime?.class;
  if (typeof getClass !== 'function') return true;
  try {
    const setting = asRecord((getClass as Function).call(runtime, 'SettingManager'));
    const skillSets = asRecord(setting?.SkillSets);
    return skillSets?.IsShowCardTag !== false;
  } catch {
    return true;
  }
}

function visibleMingpaiTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => String(tag).trim()).filter((tag) => (
    tag && !tag.startsWith('来源:') && !tag.startsWith('来源：')
  )))];
}

function call(target: UnknownRecord | null | undefined, methodName: string, ...args: unknown[]): unknown {
  const method = target?.[methodName];
  return typeof method === 'function' ? method.apply(target, args) : undefined;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function readCardId(card: unknown): number {
  if (typeof card === 'number') return card;
  const record = asRecord(card);
  const inner = asRecord(record?.Card) ?? asRecord(record?.card) ?? asRecord(record?.cardInfo) ?? record;
  return Number(inner?.CardId ?? inner?.cardId ?? inner?.CardID ?? inner?.cardID ?? 0);
}

function readArray(record: UnknownRecord | null, keys: readonly string[]): unknown[] {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}
