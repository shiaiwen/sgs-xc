/**
 * 原生明牌预览。
 *
 * 其他座位武将牌下方画小牌条：确定牌一排，可能牌半透明并带问号。
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
import type { SeatStateStore } from '../seat-display/seat-state-store.ts';
import { HAND_ZONE, type MingpaiEngine } from './mingpai-engine.ts';
import {
  getSeatPossibleCardIds,
  getZone4Rows,
  type Zone4Row
} from './graph/mingpai-candidates.ts';
import { readSpellName } from './spell-name.ts';
import { TANQUE_STATE_ID, tanqueDiffLabel } from './rules/tanque-label.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';

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
const POLL_INTERVAL_MS = 250;
const GAME_FONT = 'fzltchjw';
const NATIVE_GUARD_KEY = '__xcVueMingpaiNativeGuard';

interface SeatStrip {
  seatId: number;
  strip: UnknownRecord;
  hit: UnknownRecord;
  signature: string;
  cardIds: number[];
  possibleIds: number[];
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
  let scene: UnknownRecord | null = null;
  let parent: UnknownRecord | null = null;
  let root: UnknownRecord | null = null;
  const strips = new Map<number, SeatStrip>();
  /** 从 HandShowCards 补进手牌区的牌。离开展示列表时只移走这些。 */
  const officialShownBySeat = new Map<number, Set<number>>();
  const recommendedBySeat = new Map<number, Set<number>>();
  const selectedBySeat = new Map<number, Set<number>>();
  const markTimers = new Map<number, number>();
  const tagMethodPatches: { prototype: object; descriptor: PropertyDescriptor }[] = [];
  let syncing = false;
  let lastEquipmentTagRefreshAt = 0;
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
    clearHideTimer();
    destroyPopup();
    [...strips.values()].forEach(destroyStrip);
    if (root) destroyNode(root);
    scene = parent = root = null;
    pinnedSeatId = null;
    officialShownBySeat.clear();
  }

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
      created.zOrder = 200000;
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

  function createStrip(seatId: number, host: UnknownRecord): SeatStrip | null {
    const strip = createSprite(`xcVueMingpaiPreviewStrip-${seatId}`);
    const hit = createSprite(`xcVueMingpaiPreviewHit-${seatId}`);
    if (!strip || !hit) return null;
    strip.mouseEnabled = true;
    strip.mouseThrough = true;
    strip.zOrder = 100 + seatId;
    hit.mouseEnabled = true;
    hit.mouseThrough = false;
    hit.hitTestPrior = true;
    hit.zOrder = 1000;
    call(strip, 'addChild', hit);
    call(host, 'addChild', strip);
    const entry: SeatStrip = {
      seatId, strip, hit, signature: '', cardIds: [], possibleIds: [], zone4Rows: [],
      tagsByCardId: new Map(), anchor: null, nativeSprite: null
    };
    const Event = readLayaEvent();
    call(hit, 'on', Event?.ROLL_OVER ?? 'mouseover', entry, () => {
      if (pinnedSeatId !== null && pinnedSeatId !== seatId) return;
      clearHideTimer();
      showPopup(entry);
    });
    call(hit, 'on', Event?.ROLL_OUT ?? 'mouseout', entry, scheduleHide);
    call(hit, 'on', Event?.CLICK ?? 'click', entry, (event: UnknownRecord) => {
      call(event, 'stopPropagation');
      clearHideTimer();
      pinnedSeatId = pinnedSeatId === seatId ? null : seatId;
      if (pinnedSeatId === null) destroyPopup();
      else showPopup(entry);
    });
    strips.set(seatId, entry);
    return entry;
  }

  function equipmentHintText(seatId: number): string {
    const seat = seatStateStore.getSnapshot().seats.find((entry) => entry.seatId === seatId);
    return [...new Set((seat?.equipmentCards ?? []).flatMap((card) => card.hints ?? []))].join(' ');
  }

  function renderStrip(
    entry: SeatStrip,
    cardIds: number[],
    possibleIds: number[],
    tagsByCardId: Map<number, string[]>,
    zone4Rows: Zone4Row[],
    anchor: Rect
  ): void {
    const rows = [
      { cardIds, possible: false },
      { cardIds: possibleIds, possible: true }
    ].filter((row) => row.cardIds.length);
    const hintText = equipmentHintText(entry.seatId);
    const zone4Signature = zone4Rows
      .map((row) => `${row.zoneId}:${row.knownCardIds.join(',')}:${row.possibleCardIds.join(',')}`)
      .join(';');
    const signature = `${cardIds.join(',')}|${possibleIds.join(',')}|${hintText}|${zone4Signature}|${JSON.stringify([...tagsByCardId])}`;
    if (entry.signature !== signature) {
      readChildren(entry.strip)
        .filter((child) => child !== entry.hit)
        .forEach(destroyNode);
      rows.forEach((row, rowIndex) => {
        const y = rowIndex * (TILE_HEIGHT + ROW_GAP);
        const truncated = row.cardIds.length > MAX_VISIBLE_TILES;
        const visible = truncated ? row.cardIds.slice(0, MAX_VISIBLE_TILES - 1) : row.cardIds;
        visible.forEach((cardId, index) => {
          const tile = createTile(cardId, row.possible, tagsByCardId.get(cardId) ?? []);
          if (!tile) return;
          call(tile, 'pos', (TILE_WIDTH + TILE_GAP) * index, y);
          tile.zOrder = index + 2;
          call(entry.strip, 'addChild', tile);
        });
        if (truncated) {
          const ellipsis = createEllipsisTile();
          if (ellipsis) {
            call(ellipsis, 'pos', (TILE_WIDTH + TILE_GAP) * visible.length, y);
            ellipsis.zOrder = visible.length + 2;
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
    entry.possibleIds = possibleIds;
    entry.zone4Rows = zone4Rows;
    entry.tagsByCardId = tagsByCardId;
    entry.anchor = anchor;
    const tileCount = Math.max(0, ...rows.map((row) => Math.min(row.cardIds.length, MAX_VISIBLE_TILES)));
    const width = tileCount * TILE_WIDTH + Math.max(0, tileCount - 1) * TILE_GAP;
    const height = rows.length * TILE_HEIGHT + Math.max(0, rows.length - 1) * ROW_GAP;
    const viewport = readViewport(root);
    const scaledWidth = width * STRIP_SCALE;
    const scaledHeight = height * STRIP_SCALE;
    const x = clamp(anchor.x - STRIP_OFFSET_X, viewport.x + VIEWPORT_MARGIN, viewport.x + viewport.width - scaledWidth - VIEWPORT_MARGIN);
    const y = clamp(anchor.y + anchor.height + STRIP_OFFSET_Y, viewport.y + VIEWPORT_MARGIN, viewport.y + viewport.height - scaledHeight - VIEWPORT_MARGIN);
    call(entry.strip, 'size', width, height);
    call(entry.strip, 'scale', STRIP_SCALE, STRIP_SCALE);
    entry.strip.scaleX = STRIP_SCALE;
    entry.strip.scaleY = STRIP_SCALE;
    call(entry.strip, 'pos', x, y);
    call(entry.hit, 'size', width, height);
    call(entry.hit, 'pos', 0, 0);
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
    if (!root || !entry.anchor
      || (!entry.cardIds.length && !entry.possibleIds.length && !entry.zone4Rows.length)) {
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
    const available = Math.max(cardWidth + POPUP_PADDING * 2, maxWidth || 1600);
    const sections = [
      { label: `确定牌（${entry.cardIds.length}）`, color: '#FFF3D0', cardIds: entry.cardIds, possible: false },
      { label: `可能牌（${entry.possibleIds.length}）`, color: '#C9C1B1', cardIds: entry.possibleIds, possible: true },
      ...zone4Sections(entry.zone4Rows)
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
    const signature = `${entry.seatId}:${entry.cardIds.join(',')}|${entry.possibleIds.join(',')}:${[...receivedMarks].join(',')}:${[...selectedMarks].join(',')}:${teamMarkable}:${zone4Sections(entry.zone4Rows).map((section) => `${section.label}${section.cardIds.join(',')}`).join(';')}:${Math.round(width)}:${direction}`;

    if (!popup || popupSignature !== signature) {
      destroyPopup();
      const created = createSprite('xcVueMingpaiCardList');
      if (!created) return;
      created.mouseEnabled = true;
      created.mouseThrough = false;
      created.zOrder = 10000;
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
          const x = POPUP_PADDING + index * section.step;
          const y = top + POPUP_TITLE_HEIGHT;
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
            view.holder.zOrder = 10 + index;
            view.ui.zOrder = 10 + index;
            popupCards.push(view);
          } else {
            const tile = createTile(cardId, section.possible, entry.tagsByCardId.get(cardId) ?? []);
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
          if (section.possible) {
            if (view) view.ui.alpha = POSSIBLE_ALPHA;
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
    const snapshot = seatStateStore.getSnapshot();
    if (!snapshot.inGame) {
      destroyAll();
      return;
    }
    const host = ensureRoot();
    if (!host || !scene) return;
    const seatUis = readSeatUis(scene);
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
        refreshNativeCardTags(handUis, ['心幽', '椒遇'], true, (card) => tanqueDiffLabel(readCardNumber(card), tanquePoint));
        refreshNativeCardTags(readShownHandEntries(asRecord(seatUi.seat), seatUi), ['心幽', '椒遇'], true);
      }
      if (seat.seatId === snapshot.selfSeatId) {
        // 本机手牌仍由游戏原生组件承载选牌/技能交互，不能隐藏它。
        const existing = strips.get(seat.seatId);
        if (existing?.nativeSprite) restoreNativeSprite(existing);
        continue;
      }
      const anchor = seatUi ? readAnchorRect(seatUi, host) : null;
      syncShownHandCards(seat.seatId, seatUi, engineSnapshot);
      // 明牌条只画引擎手牌区，不跟场景里的过期列表互相覆盖。
      const equipmentIds = new Set(
        (seat.equipmentCards ?? []).map((card) => card.cardId).filter((cardId) => cardId > 0)
      );
      const currentKnownIds = new Set(seat.knownCards.map((card) => card.cardId));
      const engineHandIds = (mingpaiEngine?.getHandCardIds(seat.seatId) ?? [])
        .filter((cardId) => cardId > 0 && !equipmentIds.has(cardId));
      const cardIds = engineHandIds.filter((cardId) => currentKnownIds.has(cardId));
      const engineTagsByCardId = new Map((engineSnapshot?.records ?? [])
        .filter((record) => record.persistentTags.length)
        .map((record) => [record.cardId, record.persistentTags] as const));
      const tagsByCardId = new Map(cardIds.flatMap((cardId) => {
        const sceneTags = seat.knownCards.find((card) => card.cardId === cardId)?.tags ?? [];
        const engineTags = engineTagsByCardId.get(cardId) ?? [];
        const tags = visibleMingpaiTags([...sceneTags, ...engineTags]);
        return tags.length ? [[cardId, tags] as const] : [];
      }));
      // 可能牌同时取座位快照与牌位图里「明组展开」的结果，任一边知道都算。
      // 已经认成确定牌的不再报可能牌：场景列表还没跟上时也要按确定牌处理，
      // 否则同一张牌会既在确定牌里、又在可能牌里挂个问号。
      const graphPossibleIds = mingpaiEngine ? getSeatPossibleCardIds(seat.seatId) : [];
      const knownIdSet = new Set([...cardIds, ...engineHandIds]);
      let possibleIds = [...new Set([
        ...(seat.possibleCards ?? []).map((card) => card.cardId),
        ...graphPossibleIds
      ])].filter((cardId) => cardId > 0 && !equipmentIds.has(cardId) && !knownIdSet.has(cardId));
      // 郭照：判定牌一律明牌，她拿到的牌牌面是确定的，手上不该再挂可能牌。
      if (seatUi && seatIsGuozhao(seatUi) && possibleIds.length) {
        possibleIds.forEach((cardId) => cardIds.push(cardId));
        possibleIds = [];
      }
      const existing = strips.get(seat.seatId);
      if (!seatUi || !anchor || (!cardIds.length && !possibleIds.length)) {
        if (existing) destroyStrip(existing);
        continue;
      }
      // 游戏自己在显示这个座位的明牌时让位给官方框：不隐藏它，也不画自己的小牌条。
      if (gameShowsOwnMingpai(seatUi)) {
        if (existing) destroyStrip(existing);
        continue;
      }
      const entry = existing ?? createStrip(seat.seatId, host);
      if (!entry) continue;
      hideNativeSprite(entry, seatUi);
      renderStrip(entry, cardIds, possibleIds, tagsByCardId, getZone4Rows(seat.seatId), anchor);
      activeSeatIds.add(seat.seatId);
      if (popupSeatId === seat.seatId) showPopup(entry);
    }
    [...strips.values()]
      .filter((entry) => !activeSeatIds.has(entry.seatId))
      .forEach(destroyStrip);
  }

  function sync(): void {
    if (stopped || syncing) return;
    syncing = true;
    try {
      syncNow();
    } finally {
      syncing = false;
    }
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
   */
  function installXinyouTagHook(rawUi: unknown): void {
    const cardUi = asRecord(rawUi);
    if (!cardUi) return;
    let prototype = Object.getPrototypeOf(cardUi) as UnknownRecord | null;
    while (prototype && !Object.prototype.hasOwnProperty.call(prototype, 'UpdateTag')) {
      prototype = Object.getPrototypeOf(prototype) as UnknownRecord | null;
    }
    if (!prototype || tagMethodPatches.some((patch) => patch.prototype === prototype)) return;
    const descriptor = Object.getOwnPropertyDescriptor(prototype, 'UpdateTag');
    if (!descriptor || typeof descriptor.value !== 'function') return;
    const original = descriptor.value as (this: unknown, ...args: unknown[]) => unknown;
    const patched = function (this: UnknownRecord, ...args: unknown[]) {
      stampPersistentCardTags(this);
      return original.apply(this, args);
    };
    try {
      Object.defineProperty(prototype, 'UpdateTag', { ...descriptor, value: patched });
      tagMethodPatches.push({ prototype, descriptor });
    } catch {
      // 原型不可写时仍靠轮询把标签写回。
    }
  }

  /** 心幽、椒遇，以及顺手、火攻这类来源短名，写进游戏绘制用的数组。 */
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

  const tanquePointBySeat = new Map<number, number>();
  const labelLayoutPatched = new WeakSet<object>();

  /** 来源短名贴在牌面最下方，避开游戏自己的标签。 */
  function ensureSourceLabelLayout(cardUi: UnknownRecord): void {
    const prototype = Object.getPrototypeOf(cardUi) as UnknownRecord | null;
    if (!prototype || labelLayoutPatched.has(prototype)) return;
    if (typeof prototype.layoutTagUI !== 'function') return;
    const original = prototype.layoutTagUI as (this: UnknownRecord, ...args: unknown[]) => unknown;
    let wrapped: (this: UnknownRecord, ...args: unknown[]) => unknown;
    wrapped = function (this: UnknownRecord, ...args: unknown[]) {
      const laidOut = original.apply(this, args);
      const button = asRecord(this.__xcLabelBtn);
      if (button?.visible) {
        let y = (Number(this.height) || 0) - 5;
        for (const key of ['macthCardTagTex', 'macthCardTagTex2']) {
          const tag = asRecord(this[key]);
          if (tag?.visible) y -= Number(tag.height) - 5;
        }
        for (const key of ['cardTagBtn', 'cardTagBtn2', 'cardTagBtn3']) {
          const tag = asRecord(this[key]);
          if (tag?.visible) y -= Number(tag.height);
        }
        button.y = y - Number(button.height);
      }
      return laidOut;
    };
    try {
      prototype.layoutTagUI = wrapped;
      labelLayoutPatched.add(prototype);
    } catch {
      // 原型不可写时仍把标签按钮挂到牌上。
    }
  }

  /** 自己的手牌用牌面按钮显示「火攻」这类短名，不依赖游戏有没有绘制 tagArr1。 */
  function paintSourceLabelButton(cardUi: UnknownRecord, labels: readonly string[]): void {
    const text = labels.join('');
    const existing = asRecord(cardUi.__xcLabelBtn);
    if (!text) {
      if (existing) existing.visible = false;
      return;
    }
    ensureSourceLabelLayout(cardUi);
    let button = existing;
    if (!button) {
      if (typeof cardUi.getCardTagBtn !== 'function' || typeof cardUi.addChild !== 'function') return;
      button = asRecord((cardUi.getCardTagBtn as () => unknown)());
      if (!button) return;
      button.mouseEnabled = false;
      button.mouseChildren = false;
      cardUi.__xcLabelBtn = button;
      (cardUi.addChild as (child: unknown) => unknown)(button);
    }
    if (button.label !== text) {
      button.label = text;
      if (typeof cardUi.resetTagSize === 'function') (cardUi.resetTagSize as (tag: unknown) => unknown)(button);
    }
    button.visible = true;
    if (typeof cardUi.layoutTagUI === 'function') (cardUi.layoutTagUI as () => unknown)();
  }

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
    dynamicLabel?: (card: UnknownRecord) => string | null
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
        ? [...labels.filter((label) => persistent.includes(label)), ...sourceLabels]
        : [];
      const tagKey = Object.prototype.hasOwnProperty.call(card, 'tagArr1') ? 'tagArr1' : 'TagArr1';
      const originalTags = card[tagKey];
      const tags = Array.isArray(originalTags) ? originalTags.map(String) : [];
      const managed = new Set<string>([...labels, ...tags.filter((tag) => tag.startsWith('['))]);
      const nextTags = [...new Set([...tags.filter((tag) => !managed.has(tag)), ...extra])];
      const buttonLabels = [...sourceLabels, ...(dynamic ? [dynamic] : [])];
      if (!extra.length && !dynamic && !tags.some((tag) => managed.has(tag)) && !asRecord(cardUi.__xcLabelBtn)) continue;
      const changed = JSON.stringify(tags) !== JSON.stringify(nextTags);
      paintSourceLabelButton(cardUi, buttonLabels);
      if (!changed) continue;
      try {
        call(cardUi, 'AddCardTag');
        card[tagKey] = nextTags;
        call(cardUi, 'UpdateTag');
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
    // 技能看牌只进 HandShowCards，不进 HandCards。只有两边卡号有交集时，才用实时手牌判断哪张已经离开。
    if (handCount === 0) next.clear();
    else if (Number.isInteger(handCount) && handCount > 0 && next.size > handCount) {
      // 展示列表可能残留上一状态的卡号；不能让它把明牌条撑到实际手牌数以上。
      const current = [...next].slice(0, handCount);
      next.clear();
      current.forEach((cardId) => next.add(cardId));
    }
    const liveHandConfirmsMembership = [...next].some((cardId) => liveHand.has(cardId));
    for (const cardId of [...next]) {
      if (equipmentIds.has(cardId)) next.delete(cardId);
      else if (
        liveHandConfirmsMembership
        && Number.isFinite(handCount)
        && liveHand.size === handCount
        && !liveHand.has(cardId)
      ) next.delete(cardId);
    }
    const placedOutsideThisHand = (cardId: number) => {
      const location = engineSnapshot?.records.find((record) => record.cardId === cardId)?.location;
      if (!location) return false;
      return location.zone !== HAND_ZONE || location.seatId !== seatId;
    };
    const previous = officialShownBySeat.get(seatId) ?? new Set<number>();
    for (const cardId of next) {
      if (previous.has(cardId) || placedOutsideThisHand(cardId)) continue;
      mingpaiEngine.observeKnownHandCard(cardId, seatId, []);
    }
    // 离开官方公开手牌列表的牌只回收普通标签，不推断它去了哪里。
    mingpaiEngine.syncOfficialHand(seatId, [...next]);
    const kept = new Set([...next].filter((cardId) => !placedOutsideThisHand(cardId)));
    if (kept.size) officialShownBySeat.set(seatId, kept);
    else officialShownBySeat.delete(seatId);
  }

  function readHandCardUis(seatUi: UnknownRecord): unknown[] {
    const container = asRecord(seatUi.cardContainer);
    return readArray(container, ['cardUis', 'cardUIs', 'handCardUis', 'handCardUIs']);
  }

  function onGameEvent(event: import('../../runtime/game-event-bus.ts').GameEvent): void {
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

  const stopSeatState = seatStateStore.subscribe(sync);
  const stopMingpai = mingpaiEngine?.subscribe(sync);
  const stopGameEvents = gameEvents?.subscribe(onGameEvent);
  const stopConfig = configStore.subscribe('display.seatUiEnabled', sync);
  const timer = window.setInterval(sync, POLL_INTERVAL_MS);
  sync();

  return () => {
    stopped = true;
    window.clearInterval(timer);
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

/** 官方明牌组件与小牌条重叠，显示期间强制隐藏，卸载时恢复。 */
function hideNativeSprite(entry: SeatStrip, seatUi: UnknownRecord): void {
  const manager = asRecord(seatUi.otherTopManager) ?? asRecord(seatUi.topManager);
  const sprite = asRecord(manager?.handCardSpr);
  if (entry.nativeSprite && entry.nativeSprite !== sprite) restoreNativeSprite(entry);
  if (!sprite || sprite.destroyed) return;
  if (sprite === seatUi) return;
  const width = Number(sprite.width || sprite._width || 0);
  const height = Number(sprite.height || sprite._height || 0);
  if (width > 480 || height > 240) return;
  const name = String(sprite.name || '');
  if (/Scene|Layer|Stage|Table|Desk|gamescene/i.test(name)) return;
  entry.nativeSprite = sprite;
  if (sprite[NATIVE_GUARD_KEY]) return;
  const ownDescriptor = Object.getOwnPropertyDescriptor(sprite, 'visible');
  const inherited = findDescriptor(Object.getPrototypeOf(sprite), 'visible');
  const descriptor = ownDescriptor ?? inherited;
  let storedValue = ownDescriptor && 'value' in ownDescriptor ? Boolean(ownDescriptor.value) : Boolean(sprite.visible);
  const write = (value: boolean) => {
    if (typeof descriptor?.set === 'function') descriptor.set.call(sprite, value);
    else storedValue = value;
  };
  const guard = { ownDescriptor, requestedVisible: Boolean(sprite.visible), write, read: () => storedValue };
  try {
    Object.defineProperty(sprite, NATIVE_GUARD_KEY, { configurable: true, value: guard });
    Object.defineProperty(sprite, 'visible', {
      configurable: true,
      enumerable: ownDescriptor?.enumerable ?? false,
      get: () => false,
      set(value: unknown) {
        guard.requestedVisible = Boolean(value);
        write(false);
        if ('_visible' in sprite) sprite._visible = false;
      }
    });
    write(false);
    if ('_visible' in sprite) sprite._visible = false;
  } catch {
    // 官方组件不可改写时保持原样。
  }
}

function restoreNativeSprite(entry: SeatStrip): void {
  const sprite = entry.nativeSprite;
  entry.nativeSprite = null;
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
function zone4Sections(rows: readonly Zone4Row[]): Array<{
  label: string;
  color: string;
  cardIds: number[];
  possible: boolean;
}> {
  return rows.flatMap((row) => {
    const name = readSpellName(row.spellId);
    const title = name || (row.spellId ? `技能${row.spellId}` : '标记');
    const sections: Array<{ label: string; color: string; cardIds: number[]; possible: boolean }> = [];
    if (row.knownCardIds.length) {
      sections.push({
        label: `${title}（${row.knownCardIds.length}）`,
        color: '#E6E7AF',
        cardIds: row.knownCardIds,
        possible: false
      });
    }
    if (row.possibleCardIds.length) {
      sections.push({
        label: `可能·${title}（${row.possibleCardIds.length}）`,
        color: '#C9C1B1',
        cardIds: row.possibleCardIds,
        possible: true
      });
    }
    return sections;
  });
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
    tag && !tag.startsWith('来源:') && !tag.startsWith('来源于')
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
