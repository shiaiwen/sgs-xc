/**
 * 原生明牌预览。
 *
 * 其他座位武将牌下方画小牌条：确定牌一排。能叫出牌名的可能牌另起一排，仍用半透明和红色问号。
 * 技能不画成小牌。只有问号、叫不出牌名的一组不画。
 * 悬停或点击弹出官方牌面，并显示队友标记和牌面标签。
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
  type OfficialCardLabels,
  type OfficialCardView
} from '../cards/official-card-renderer.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import { readGameSeatId, readNativeHandCardTags, readSeatHandCardCount, readShownHandEntries } from '../seat-display/seat-game-adapter.ts';
import type { GameSeatSnapshot } from '../seat-display/seat-state.ts';
import type { SeatStateStore } from '../seat-display/seat-state-store.ts';
import { HAND_ZONE, type MingpaiEngine } from './mingpai-engine.ts';
import { getMingpaiCardTags } from './graph/card-graph.ts';
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
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  isNamedPossibleGroup,
  mingpaiStripTiles,
  partitionZone4RowsForStrip,
  stripBlockedSkillCardIds,
  zone4CardIds
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
import { measureXiaochao } from '../../runtime/perf-monitor.ts';
import { everyInterval } from '../../runtime/shared-ticker.ts';
import { isGameSeatUiFlowActive } from '../../runtime/game-native-dialog.ts';
import {
  clampExtensionZOrder,
  EXTENSION_Z_BELOW_GAME_TIP,
  isGeneralSkillTipStayInteractive
} from '../../runtime/game-tip-layer.ts';
import {
  layoutPopupSection,
  POPUP_PADDING,
  POPUP_TITLE_HEIGHT,
  popupCardPosition
} from './popup-section-layout.ts';

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
const HIDE_DELAY_MS = 120;
const STRIP_TILE_POINTER_BOUND = '__xcMingpaiStripTilePointerBound';
const POLL_INTERVAL_MS = 1000;
const POLL_INTERVAL_OUT_OF_GAME_MS = 2000;
const PREVIEW_PERF_LABEL = '明牌小牌条';
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
  tagsByCardId: Map<number, OfficialCardLabels>;
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
  let parent: UnknownRecord | null = null;
  let root: UnknownRecord | null = null;
  const strips = new Map<number, SeatStrip>();
  /** 从 HandShowCards 补进手牌区的牌。离开展示列表时只移走这些。 */
  const officialShownBySeat = new Map<number, Set<number>>();
  const recommendedBySeat = new Map<number, Set<number>>();
  const selectedBySeat = new Map<number, Set<number>>();
  const markTimers = new Map<number, number>();
  let syncing = false;
  let stopPolling: (() => void) | null = null;
  let syncTimer = 0;
  let popup: UnknownRecord | null = null;
  let popupCards: OfficialCardView[] = [];
  let popupSeatId: number | null = null;
  let popupSignature = '';
  let pinnedSeatId: number | null = null;
  let hideTimer = 0;

  /** 取消等待关闭弹层的计时，鼠标重新进入时保留当前弹层。 */
  const clearHideTimer = () => {
    if (hideTimer) window.clearTimeout(hideTimer);
    hideTimer = 0;
  };
  /** 鼠标离开牌条后稍等片刻，给它移动到弹层的时间。 */
  const scheduleHide = () => {
    if (pinnedSeatId !== null) return;
    clearHideTimer();
    hideTimer = window.setTimeout(() => {
      hideTimer = 0;
      destroyPopup();
    }, HIDE_DELAY_MS);
  };

  /** 释放弹层中的官方牌面与绘制层，并清掉当前弹层状态。 */
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

  /** 移除一个座位的小牌条，并恢复它关联的游戏原生节点。 */
  function destroyStrip(entry: SeatStrip): void {
    restoreNativeSprite(entry);
    destroyNode(entry.strip);
    strips.delete(entry.seatId);
    if (popupSeatId === entry.seatId) destroyPopup();
    if (pinnedSeatId === entry.seatId) pinnedSeatId = null;
  }

  /** 场景离开或根节点失效时，把本控制器添加的 Laya 节点全部卸掉。 */
  function destroyAll(): void {
    releaseSceneNativeHandGuards(asRecord(scene) ?? asRecord(locateGameScene(window)));
    clearHideTimer();
    destroyPopup();
    [...strips.values()].forEach(destroyStrip);
    if (root) destroyNode(root);
    scene = parent = root = null;
    pinnedSeatId = null;
    officialShownBySeat.clear();
  }

  /** 把覆盖层挂到当前牌局场景；场景或父节点换了就重建根节点。 */
  function ensureRoot(): UnknownRecord | null {
    const nextScene = asRecord(locateGameScene(window));
    const roundInfo = asRecord(nextScene?.gameRoundInfo);
    const nextParent = asRecord(roundInfo?._parent) ?? roundInfo ?? nextScene;
    if (!nextScene || !nextParent || nextScene.destroyed || nextParent.destroyed) {
      destroyAll();
      return null;
    }
    if (scene !== nextScene || parent !== nextParent || !root || root.destroyed || !(root.parent || root._parent)) {
      destroyAll();
      const created = createSprite('xcVueMingpaiPreviewRoot');
      if (!created) return null;
      created.mouseEnabled = true;
      created.mouseThrough = true;
      created.zOrder = clampExtensionZOrder(500);
      call(created, 'pos', 0, 0);
      call(nextParent, 'addChild', created);
      call(nextParent, 'sortChildren');
      scene = nextScene;
      parent = nextParent;
      root = created;
    }
    const viewport = readViewport(root);
    call(root, 'size', Math.max(1, Number(parent?.width) || viewport.x + viewport.width), Math.max(1, Number(parent?.height) || viewport.y + viewport.height));
    return root;
  }

  /** 技能说明停驻期间让牌条卡片透传鼠标事件。 */
  function setStripTilePassThrough(tile: UnknownRecord, passThrough: boolean): void {
    if (passThrough) {
      tile.mouseEnabled = false;
      tile.mouseThrough = true;
      tile.hitTestPrior = false;
      return;
    }
    tile.mouseEnabled = true;
    tile.mouseThrough = false;
    tile.hitTestPrior = false;
  }

  /** 给小牌绑定悬停预览和点击固定弹层的交互，同一节点只绑定一次。 */
  function attachStripTilePointerEvents(tile: UnknownRecord, entry: SeatStrip): void {
    if (tile[STRIP_TILE_POINTER_BOUND] === true) return;
    tile[STRIP_TILE_POINTER_BOUND] = true;
    setStripTilePassThrough(tile, false);
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

  /** 技能说明停驻时让小牌条不拦截鼠标，避免误判移开而自动关 tip。 */
  function applyStripPointerYield(yieldToSkillTip: boolean): void {
    for (const entry of strips.values()) {
      for (const child of readChildren(entry.strip)) {
        if (child[STRIP_TILE_POINTER_BOUND] !== true) continue;
        setStripTilePassThrough(child, yieldToSkillTip);
      }
    }
  }

  /** 为座位新建牌条容器，并登记后续重绘所需的状态。 */
  function createStrip(seatId: number, seatUi: UnknownRecord): SeatStrip | null {
    if (!root) return null;
    const strip = createSprite(`xcVueMingpaiPreviewStrip-${seatId}`);
    if (!strip) return null;
    call(root, 'addChild', strip);
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

  /** 合并装备区提供的提示文字，避免同一提示在牌条里重复出现。 */
  function equipmentHintText(seatId: number): string {
    const seat = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === seatId);
    return [...new Set((seat?.equipmentCards ?? []).flatMap((card) => card.hints ?? []))].join(' ');
  }

  /** 收集该座位可能持有的牌，排除已经确定、装备区和技能区的卡号。 */
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

  /** 内容变化时重建小牌，位置变化时只更新座位锚点和牌条坐标。 */
  function renderStrip(
    entry: SeatStrip,
    cardIds: number[],
    possibleGroups: PossibleGroupView[],
    tagsByCardId: Map<number, OfficialCardLabels>,
    zone4Rows: Zone4Row[],
    skillCardIds: ReadonlySet<number>,
    anchor: Rect
  ): void {
    // 牌条只保留确定牌和能命名的可能牌；弹层所需的技能区数据仍存到 entry。
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
    // 牌面没变时保留 Laya 节点和鼠标绑定，只刷新数据、锚点及坐标。
    if (entry.signature !== signature) {
      readChildren(entry.strip).forEach(destroyNode);
      rows.forEach((row, rowIndex) => {
        const y = rowIndex * (TILE_HEIGHT + ROW_GAP);
        const truncated = row.items.length > MAX_VISIBLE_TILES;
        const visible = truncated ? row.items.slice(0, MAX_VISIBLE_TILES - 1) : row.items;
        visible.forEach((item, index) => {
          // 小牌条只画牌面。来源短名写在游戏自己的手牌标签上。
          const tile = createTile(item.cardId, row.possible);
          if (!tile) return;
          call(tile, 'pos', (TILE_WIDTH + TILE_GAP) * index, y);
          tile.zOrder = index + 2;
          if (isGeneralSkillTipStayInteractive(window)) {
            setStripTilePassThrough(tile, true);
          } else {
            attachStripTilePointerEvents(tile, entry);
          }
          call(entry.strip, 'addChild', tile);
        });
        if (truncated) {
          const ellipsis = createEllipsisTile();
          if (ellipsis) {
            call(ellipsis, 'pos', (TILE_WIDTH + TILE_GAP) * visible.length, y);
            ellipsis.zOrder = visible.length + 2;
            if (isGeneralSkillTipStayInteractive(window)) {
              setStripTilePassThrough(ellipsis, true);
            } else {
              attachStripTilePointerEvents(ellipsis, entry);
            }
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
    // 悬停弹层读取最新数据，不能因牌条外观相同而留下旧标签或可能牌。
    entry.cardIds = cardIds;
    entry.possibleGroups = possibleGroups;
    entry.zone4Rows = zone4Rows;
    entry.tagsByCardId = tagsByCardId;
    entry.anchor = anchor;
    if (!root) return;
    const tileCount = Math.max(0, ...rows.map((row) => Math.min(row.items.length, MAX_VISIBLE_TILES)));
    const width = tileCount * TILE_WIDTH + Math.max(0, tileCount - 1) * TILE_GAP;
    const height = rows.length * TILE_HEIGHT + Math.max(0, rows.length - 1) * ROW_GAP;
    const viewport = readViewport(root);
    const scaledWidth = width * STRIP_SCALE;
    const scaledHeight = height * STRIP_SCALE;
    const x = clamp(
      anchor.x - STRIP_OFFSET_X,
      viewport.x + VIEWPORT_MARGIN,
      viewport.x + viewport.width - scaledWidth - VIEWPORT_MARGIN
    );
    const y = clamp(
      anchor.y + anchor.height + STRIP_OFFSET_Y,
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

  /** 用 Laya 节点画一张小牌；可能牌叠问号并降低透明度。 */
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

  /** 牌条超出可见张数时画省略牌，点击仍可打开完整弹层。 */
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

  /** 按确定牌、可能牌和技能区分栏生成官方牌面弹层。 */
  function showPopup(entry: SeatStrip): void {
    if (!root || !entry.anchor
      || (!entry.cardIds.length && !entry.possibleGroups.length && !entry.zone4Rows.length)) {
      destroyPopup();
      return;
    }
    const viewport = readViewport(root);
    const direction = chooseDirection(entry.anchor, viewport);
    const maxWidth = direction === 'right'
      ? viewport.x + viewport.width - VIEWPORT_MARGIN - entry.anchor.x - entry.anchor.width - POPUP_OFFSET
      : entry.anchor.x - viewport.x - VIEWPORT_MARGIN - POPUP_OFFSET;
    const cardWidth = Math.max(1, Math.round(OFFICIAL_CARD_BASE_WIDTH * POPUP_CARD_SCALE));
    const cardHeight = Math.max(1, Math.floor(OFFICIAL_CARD_BASE_HEIGHT * POPUP_CARD_SCALE));
    const viewportSpan = Math.max(1, viewport.width - VIEWPORT_MARGIN * 2);
    const anchorSideWidth = Math.max(
      cardWidth + POPUP_PADDING * 2,
      Math.min(maxWidth, viewportSpan)
    );
    // 各分栏分别计算换行与叠放，弹层宽度受座位左右可用空间限制。
    const zone4Sections = zone4PopupSections(entry.zone4Rows);
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
      ...zone4Sections
    ].filter((section) => section.cardIds.length).map((section) => {
      const layout = layoutPopupSection(
        section.cardIds.length,
        cardWidth,
        cardHeight,
        anchorSideWidth
      );
      return { ...section, ...layout };
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
    const layoutSig = sections.map((section) => (
      `${section.columns}x${section.rows}:${section.overlap ? 1 : 0}:${Math.round(section.width)}`
    )).join(';');
    const tagSignature = JSON.stringify([...entry.tagsByCardId]);
    const signature = `${entry.seatId}:${entry.cardIds.join(',')}|${possibleSig}:${[...receivedMarks].join(',')}:${[...selectedMarks].join(',')}:${teamMarkable}:${popupZone4Sig}:${layoutSig}:${Math.round(width)}:${direction}:${tagSignature}`;

    // 牌面、标记或布局变化才重建弹层；单纯移动座位只需更新弹层坐标。
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
      call(root, 'addChild', created);
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
          const { x, y } = popupCardPosition(index, section, top);
          const cardIsPossible = section.possible
            || (section.possibleCardIds?.has(cardId) ?? false);
          const view = createOfficialCardView(
            created,
            cardId,
            OFFICIAL_CARD_BASE_WIDTH,
            OFFICIAL_CARD_BASE_HEIGHT,
            undefined,
            { x, y },
            POPUP_CARD_SCALE,
            entry.tagsByCardId.get(cardId)
          );
          if (view) {
            if (cardIsPossible) view.ui.alpha = POSSIBLE_ALPHA;
            view.holder.zOrder = 10 + index;
            view.ui.zOrder = 10 + index;
            popupCards.push(view);
          } else {
            // 官方牌面资源暂不可用时，仍用小牌展示卡号对应的内容。
            const labels = entry.tagsByCardId.get(cardId);
            const tags = visibleMingpaiTags([...(labels?.native ?? []), ...(labels?.tracked ?? [])]);
            const tile = createTile(cardId, cardIsPossible, tags);
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
            // 队友的确定牌支持游戏原生标记，可能牌不能发送卡号标记。
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
      ? entry.anchor.x + entry.anchor.width + POPUP_OFFSET
      : entry.anchor.x - width - POPUP_OFFSET;
    const x = clamp(rawX, viewport.x + VIEWPORT_MARGIN, viewport.x + viewport.width - width - VIEWPORT_MARGIN);
    const y = clamp(
      entry.anchor.y + (entry.anchor.height - height) / 2,
      viewport.y + VIEWPORT_MARGIN,
      viewport.y + viewport.height - height - VIEWPORT_MARGIN
    );
    call(popup, 'pos', x, y);
  }

  /** 按座位快照重画小牌条和明牌弹层。 */
  function syncNow(): void {
    if (stopped) return;
    const snapshot = seatStateStore.getSnapshot();
    // 游戏原生座位交互（选牌/技能提示）进行时先关闭弹层，避免小抄挡住点击。
    if (isGameSeatUiFlowActive(window)) {
      clearHideTimer();
      if (popup) destroyPopup();
    }
    if (root) root.mouseEnabled = true;
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
    if (!snapshot.inGame) {
      destroyAll();
      return;
    }
    // 座位快照负责判定是否在局；真正的绘制父节点每轮从当前场景重新确认。
    const host = ensureRoot();
    if (!host || !scene) return;
    const seatUis = readSeatUis(scene);
    const engineSnapshot = mingpaiEngine?.getSnapshot();
    // 牌号 → 位置预建 Map，避免下面每张牌都线性 find 一遍 records。
    const locationByCardId = new Map<number, { seatId: number; zone: number } | null>();
    for (const record of engineSnapshot?.records ?? []) {
      if (locationByCardId.has(record.cardId)) continue;
      const loc = record.location;
      locationByCardId.set(record.cardId, loc ? { seatId: loc.seatId, zone: loc.zone } : null);
    }
    // 每轮只保留仍有有效座位、锚点和牌面的小牌条，场景切换后清理旧节点。
    const activeSeatIds = new Set<number>();
    for (const seat of snapshot.seats) {
      const seatUi = seatUis.get(seat.seatId);
      if (seat.seatId === snapshot.selfSeatId) {
        // 本机手牌仍由游戏原生组件承载选牌/技能交互，不能隐藏它。
        const existing = strips.get(seat.seatId);
        if (existing?.nativeSprite) restoreNativeSprite(existing);
        continue;
      }
      const anchor = seatUi ? readAnchorRect(seatUi, host) : null;
      syncShownHandCards(seat.seatId, seatUi, locationByCardId);
      // 明牌条只画引擎手牌区，不跟场景里的过期列表互相覆盖。
      const equipmentIds = new Set(
        (seat.equipmentCards ?? []).map((card) => card.cardId).filter((cardId) => cardId > 0)
      );
      const currentKnownIds = new Set(seat.knownCards.map((card) => card.cardId));
      const zone4RowsAll = getZone4Rows(seat.seatId);
      const zone4Partition = partitionZone4RowsForStrip(zone4RowsAll);
      const skillZoneCardIds = new Set(zone4Partition.stripExcludeCardIds);
      // 引擎先筛出仍在手牌区的卡号，下面再用场景可见名单补齐漏记的牌。
      const engineHandIds = (mingpaiEngine?.getHandCardIds(seat.seatId) ?? [])
        .filter((cardId) => cardId > 0 && !equipmentIds.has(cardId) && !skillZoneCardIds.has(cardId));
      const engineHandLocation = (cardId: number): { seatId: number; zone: number } | null => (
        locationByCardId.get(cardId) ?? null
      );
      const isCardInThisHand = (cardId: number): boolean => {
        const location = engineHandLocation(cardId);
        if (!location) return true;
        return location.zone === HAND_ZONE && location.seatId === seat.seatId;
      };
      let cardIds = engineHandIds
        .filter((cardId) => currentKnownIds.has(cardId) && isCardInThisHand(cardId));
      // 场景明确可见但引擎尚未登记的牌可以补入；已被引擎定位到别区的旧卡号不能补回。
      for (const known of seat.knownCards) {
        const cardId = known.cardId;
        if (cardId <= 0 || equipmentIds.has(cardId) || skillZoneCardIds.has(cardId)) continue;
        if (!currentKnownIds.has(cardId) || cardIds.includes(cardId)) continue;
        if (!isCardInThisHand(cardId)) continue;
        if (!engineHandIds.includes(cardId)) cardIds.push(cardId);
      }
      // 郭照：判定牌一律明牌，她拿到的牌牌面是确定的，手上不该再挂可能牌。
      // 可能牌留在弹层和第二排，不能挤占确定牌的显示位置。
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
      // 技能区可合并的牌只参与牌条展示，可能牌筛选仍用合并前的真实手牌集合。
      for (const merged of zone4Partition.mergeKnownBySpell) {
        for (const cardId of merged.cardIds) {
          if (!cardIds.includes(cardId)) cardIds.push(cardId);
        }
      }
      const nativeTagsById = readNativeHandCardTags(seatUi ?? null, snapshot.controlledSeatIds.includes(seat.seatId));
      const labelsEnabled = configStore.get('display.cardLabelsEnabled');
      const popupIds = new Set([
        ...cardIds,
        ...popupPossibleGroups.flatMap((group) => group.candidateCardIds),
        ...zone4PopupSections(zone4Partition.stripRows).flatMap((section) => section.cardIds)
      ]);
      const tagsByCardId = new Map<number, OfficialCardLabels>();
      for (const id of popupIds) {
        const native = cardIds.includes(id) ? nativeTagsById.get(id) ?? [] : [];
        // 心幽等牌面提示由对应技能控制。明牌列表使用游戏展示记录及持续标记。
        const tracked = labelsEnabled ? getMingpaiCardTags(id).filter(isPreviewTag) : [];
        if (native.length || tracked.length) {
          tagsByCardId.set(id, { native: visibleMingpaiTags(native), tracked: visibleMingpaiTags(tracked) });
        }
      }
      const skillCardIds = stripBlockedSkillCardIds(zone4CardIds(zone4RowsAll), keptCardIds);
      const cardName = (cardId: number) => gameCardCatalog.resolve(cardId).name;
      popupPossibleGroups = popupPossibleGroups.filter((group) => (
        isNamedPossibleGroup(group, cardName, skillCardIds)
      ));
      const zone4Rows = zone4Partition.stripRows;
      // 先算最终会画出的卡片，再决定是否需要让位给游戏原生明牌框。
      const stripTiles = mingpaiStripTiles({
        knownCardIds: cardIds,
        possibleGroups: popupPossibleGroups,
        skillCardIds,
        cardName
      });
      const existing = strips.get(seat.seatId);
      // 座位或锚点尚未就绪时先拆掉旧牌条，避免场景切换后牌条挂在原位置。
      if (!seatUi || !anchor || stripTiles.length === 0) {
        if (existing) destroyStrip(existing);
        continue;
      }
      // 原生层确实画出了本批全部明牌时才让位；网页端的展示列表可能残留旧卡号。
      if (gameShowsOwnMingpai(seatUi, stripTiles)) {
        if (existing) destroyStrip(existing);
        continue;
      }
      // 原生层没有完整牌面时由小抄补上，避免部分牌或整个牌条消失。
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
    applyStripPointerYield(isGeneralSkillTipStayInteractive(window));
  }

  const bridge = asRecord((globalThis as UnknownRecord).__XIAOCHAO_ENGINEERING__);
  if (bridge) bridge.mingpaiNativePerf = mingpaiPerf;

  /** 执行一次同步并记录耗时；重入时交由下一轮定时同步。 */
  function sync(): void {
    if (stopped || syncing) return;
    syncing = true;
    const t0 = now();
    try {
      measureXiaochao(PREVIEW_PERF_LABEL, syncNow);
    } finally {
      recordNativeSync(now() - t0);
      syncing = false;
    }
  }

  /** 合并同一帧里的座位、引擎和游戏事件，减少重复重绘。 */
  function scheduleSync(): void {
    if (stopped || syncTimer) return;
    syncTimer = window.setTimeout(() => {
      syncTimer = 0;
      sync();
    }, SYNC_DEBOUNCE_MS);
  }

  /** 切换队友牌面选择，并按游戏允许的张数发送原生卡牌标记。 */
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
   * 技能展示别人的手牌时，网页端把牌放进 HandShowCards，微端把卡号写在 HandShowCardIDs。
   * 移牌协议不一定带卡号，这些牌才补进手牌区。
   * 观星会把牌堆顶的牌短暂放进展示区，牌位图里已经有位置、且不在这名角色手上的牌不改位置。
   * 离开展示列表时再移出。
   */
  function syncShownHandCards(
    seatId: number,
    seatUi: UnknownRecord | undefined,
    locationByCardId: Map<number, { seatId: number; zone: number } | null>
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
      const location = locationByCardId.get(cardId);
      if (!location) return false;
      return location.zone !== HAND_ZONE || location.seatId !== seatId;
    };
    const liveHandConfirmsMembership = [...next].some((cardId) => liveHand.has(cardId));
    // 只有实时 HandCards 与展示名单存在交集、且张数吻合时，才用它剔除过期展示牌。
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

  /** 对局结束立即卸层；新局或重连清掉上一局的展示与队友标记缓存。 */
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
      return;
    }
    if (event.type === 'game-reconnected') {
      // 重连后牌位图整副重建，队友标记与展示列表的缓存都要跟着丢。
      recommendedBySeat.clear();
      selectedBySeat.clear();
      officialShownBySeat.clear();
      markTimers.forEach((timerId) => window.clearTimeout(timerId));
      markTimers.clear();
      return;
    }
    if (event.type !== 'friend-hand-tags-updated') return;
    recommendedBySeat.set(event.seatId, new Set(event.cardIds));
    const entry = strips.get(event.seatId);
    if (entry && popupSeatId === event.seatId) showPopup(entry);
  }

  let sessionInGame = seatStateStore.getSnapshot().inGame;
  /** 场景状态兜底处理开局与离局，接住缺失的游戏生命周期事件。 */
  const stopSession = seatStateStore.subscribe((snapshot) => {
    if (snapshot.inGame) {
      const reentered = !sessionInGame;
      sessionInGame = true;
      if (reentered || previewSuspended) {
        previewSuspended = false;
        cancelMingpaiPostGameCleanup();
      }
      return;
    }
    if (!sessionInGame) return;
    sessionInGame = false;
    previewSuspended = true;
    releaseSceneNativeHandGuards(asRecord(locateGameScene(window)));
    runPostGamePreviewCleanup();
    scheduleMingpaiPostGameCleanup();
  });

  /** 局后同步清空牌条和交互缓存，防止结算画面残留明牌。 */
  function runPostGamePreviewCleanup(): void {
    recommendedBySeat.clear();
    selectedBySeat.clear();
    officialShownBySeat.clear();
    destroyAll();
  }
  const unregisterPostGameCleanup = registerMingpaiPostGameCleanup(runPostGamePreviewCleanup);
  const unregisterHudTeardown = registerNativeHudPostGameTeardown(runPostGamePreviewCleanup);

  /** 只在牌局内运行视觉兜底轮询，离局靠订阅事件清理。 */
  function adjustPollInterval() {
    const inGame = seatStateStore.getSnapshot().inGame && !previewSuspended && !isNativeHudSuspended();
    if (!inGame) {
      // 不在牌局时不轮询，靠 seatState / gameEvents / config 事件驱动清理与重建。
      stopPolling?.();
      stopPolling = null;
      return;
    }
    if (stopPolling && pollIntervalMs === POLL_INTERVAL_MS) return;
    stopPolling?.();
    pollIntervalMs = POLL_INTERVAL_MS;
    stopPolling = everyInterval(PREVIEW_PERF_LABEL, pollIntervalMs, scheduleSync, { visualOnly: true });
  }
  let pollIntervalMs = POLL_INTERVAL_OUT_OF_GAME_MS;

  const stopSeatState = seatStateStore.subscribe(() => {
    adjustPollInterval();
    scheduleSync();
  });
  const stopMingpai = mingpaiEngine?.subscribe(scheduleSync);
  const stopGameEvents = gameEvents?.subscribe(onGameEvent);
  const stopConfig = configStore.subscribe('display.seatUiEnabled', scheduleSync);
  const stopCardLabels = configStore.subscribe('display.cardLabelsEnabled', sync);
  stopPolling = everyInterval(PREVIEW_PERF_LABEL, pollIntervalMs, () => {
    adjustPollInterval();
    scheduleSync();
  }, { visualOnly: true });
  sync();

  return () => {
    stopped = true;
    if (bridge) delete (bridge as Record<string, unknown>).mingpaiNativePerf;
    cancelMingpaiPostGameCleanup();
    unregisterPostGameCleanup();
    unregisterHudTeardown();
    stopPolling?.();
    stopPolling = null;
    if (syncTimer) window.clearTimeout(syncTimer);
    syncTimer = 0;
    stopSession();
    stopSeatState();
    stopMingpai?.();
    stopGameEvents?.();
    markTimers.forEach((timerId) => window.clearTimeout(timerId));
    markTimers.clear();
    stopConfig();
    stopCardLabels();
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

/**
 * 判断排位队友手牌、斗地主明牌等是否已由游戏原生层完整显示。
 * 展示列表只是数据记录，必须再核对当前可见的原生卡牌节点。
 */
function gameShowsOwnMingpai(seatUi: UnknownRecord, tiles: readonly { cardId: number; possible: boolean }[]): boolean {
  // 原生明牌框不能代替小抄的可能牌行，也不能替空牌条做显示判断。
  if (!tiles.length || tiles.some((tile) => tile.possible)) return false;
  const manager = asRecord(seatUi.otherTopManager) ?? asRecord(seatUi.topManager);
  const sprite = asRecord(manager?.handCardSpr);
  if (!sprite || sprite.destroyed || !sprite.visible) return false;
  const seat = asRecord(seatUi.seat);
  // 先用游戏的展示名单确认本批牌属于公开牌；只展示其中一部分时仍需小抄补齐。
  const shownIds = new Set(readShownHandEntries(seat, seatUi).map(readCardId).filter((id) => id > 0));
  if (!tiles.every((tile) => shownIds.has(tile.cardId))) return false;

  // 网页端 HandShowCards 可能在牌面撤走后继续保留卡号，逐层查找仍可见的原生卡牌。
  const renderedIds = new Set<number>();
  const visited = new Set<UnknownRecord>();
  const visit = (node: UnknownRecord) => {
    if (visited.has(node) || node.destroyed || node.visible === false) return;
    visited.add(node);
    const cardId = readCardId(node);
    if (cardId > 0) renderedIds.add(cardId);
    readChildren(node).forEach(visit);
  };
  visit(sprite);
  // 只要还有一张没有原生牌面，就保留小抄牌条。
  return tiles.every((tile) => renderedIds.has(tile.cardId));
}

/** 不改写 handCardSpr：部分客户端手牌与装备同容器，强制隐藏会导致装备区消失。 */
function hideNativeSprite(_entry: SeatStrip, _seatUi: UnknownRecord): void {
}

/** 清除旧版本遗留的原生手牌可见性守卫，恢复游戏自身的显示控制。 */
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

/** 离局时遍历所有座位，释放旧守卫以免影响下一局的原生手牌。 */
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

/** 牌条销毁后让游戏重新刷新原生手牌节点。 */
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

/** 按协议座位号索引场景中的座位 UI，供明牌条找到对应的锚点。 */
function readSeatUis(scene: UnknownRecord): Map<number, UnknownRecord> {
  const result = new Map<number, UnknownRecord>();
  const seatUis = asRecord(scene.seatContainer)?.seatUIs;
  for (const value of Array.isArray(seatUis) ? seatUis : []) {
    const seatUi = asRecord(value);
    if (!seatUi) continue;
    // 与座位状态使用同一套字段别名，浏览器对象缺少 index 时仍能定位牌条锚点。
    const seatId = readGameSeatId(seatUi);
    if (seatId !== null) result.set(seatId, seatUi);
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

/** 依次读取节点展示范围、局部边界和宽高，跳过尚未排版的节点。 */
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

/** 把舞台可见范围换算到明牌根节点坐标，用于限制牌条与弹层位置。 */
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

/** 经全局坐标把游戏节点上的点投到明牌根节点；坐标接口缺失时安全回退。 */
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

/** 选择座位旁边剩余空间较多的一侧展开弹层。 */
function chooseDirection(anchor: Rect, viewport: Rect): 'left' | 'right' {
  const rightSpace = viewport.x + viewport.width - VIEWPORT_MARGIN - anchor.x - anchor.width;
  const leftSpace = anchor.x - viewport.x - VIEWPORT_MARGIN;
  return rightSpace >= leftSpace ? 'right' : 'left';
}

/** 从当前游戏运行时创建 Laya Sprite，运行时未就绪时返回空。 */
function createSprite(name: string): UnknownRecord | null {
  const Sprite = asRecord((globalThis as UnknownRecord).Laya)?.Sprite;
  if (typeof Sprite !== 'function') return null;
  const sprite = asRecord(new (Sprite as unknown as new () => object)());
  if (sprite) sprite.name = name;
  return sprite;
}

/** 创建与游戏字体一致、不会抢占鼠标的文字节点。 */
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

/** 在 Laya 图形对象上画牌条和弹层共用的圆角背景。 */
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

/** 兼容普通节点与官方绘制子节点的不同释放方式。 */
function destroyNode(node: UnknownRecord): void {
  try {
    call(node, 'removeSelf');
    if (typeof node.addDrawChild === 'function') return;
    call(node, 'destroy', false);
  } catch {
    // 场景切换时节点可能已销毁。
  }
}

/** 读取 Laya 子节点并过滤非对象项，供牌条清理和原生牌面检查使用。 */
function readChildren(node: UnknownRecord): UnknownRecord[] {
  const children = node._children;
  return Array.isArray(children) ? children.map(asRecord).filter(Boolean) as UnknownRecord[] : [];
}

/** 沿原型链查找游戏节点的属性描述符。 */
function findDescriptor(target: object | null, key: string): PropertyDescriptor | null {
  for (let current = target; current; current = Object.getPrototypeOf(current)) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
  }
  return null;
}

/** 游戏未加载事件常量时让调用方使用字符串事件名。 */
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

/** 把技能区行转成弹层分栏；暗放牌只显示张数，不猜牌面。 */
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

/** 将浮层坐标限制在可见范围内。 */
function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(Math.max(min, max), value));
}

/** 从游戏当前提示参数读取队友标记上限，缺失时按一张处理。 */
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

/** 尊重游戏的卡牌标记开关；设置对象缺失时不阻断牌面交互。 */
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

/** 弹层只展示牌面标签，过滤已由其他位置表达的来源文字。 */
function visibleMingpaiTags(tags: readonly string[]): string[] {
  return [...new Set(tags.map((tag) => String(tag).trim()).filter((tag) => (
    tag && !tag.startsWith('来源:') && !tag.startsWith('来源：')
  )))];
}

/** 排除技能独立展示或方括号样式的标签，避免弹层重复绘制。 */
function isPreviewTag(tag: string): boolean {
  return tag !== '心幽' && tag !== '椒遇' && !tag.startsWith('[');
}

/** 动态调用不同游戏版本可能缺失的 Laya 方法。 */
function call(target: UnknownRecord | null | undefined, methodName: string, ...args: unknown[]): unknown {
  const method = target?.[methodName];
  return typeof method === 'function' ? method.apply(target, args) : undefined;
}

/** 将运行时未知值收窄为可读取字段的对象。 */
function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/** 兼容裸卡号、卡牌 UI 和嵌套牌面对象的卡号字段。 */
function readCardId(card: unknown): number {
  if (typeof card === 'number') return card;
  const record = asRecord(card);
  const inner = asRecord(record?.Card) ?? asRecord(record?.card) ?? asRecord(record?.cardInfo) ?? record;
  return Number(inner?.CardId ?? inner?.cardId ?? inner?.CardID ?? inner?.cardID ?? 0);
}

/** 按候选字段顺序读取游戏数组，兼容不同客户端的命名。 */
function readArray(record: UnknownRecord | null, keys: readonly string[]): unknown[] {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}
