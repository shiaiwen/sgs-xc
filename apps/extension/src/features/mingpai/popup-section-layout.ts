/** 明牌详情弹层内某一组牌的网格布局。 */

export interface PopupSectionLayout {
  columns: number;
  rows: number;
  stepX: number;
  stepY: number;
  width: number;
  height: number;
  overlap: boolean;
}

export const POPUP_PADDING = 8;
export const POPUP_CARD_GAP = 8;
export const POPUP_CARD_GAP_COMPACT = 5;
export const POPUP_MAX_ROW_CARDS = 10;
/** 单行区最多按此张数撑宽，再多在同宽内叠放。与小牌条一行上限一致。 */
export const POPUP_SINGLE_ROW_CAP_CARDS = 5;
export const POPUP_TITLE_HEIGHT = 26;

export function popupSingleRowInnerLimit(cardWidth: number, availableWidth: number): number {
  const availableInner = Math.max(cardWidth, availableWidth - POPUP_PADDING * 2);
  const capInner =
    POPUP_SINGLE_ROW_CAP_CARDS * cardWidth
    + Math.max(0, POPUP_SINGLE_ROW_CAP_CARDS - 1) * POPUP_CARD_GAP_COMPACT;
  return Math.min(availableInner, capInner);
}

function sectionHeight(cardHeight: number, gap: number, rows: number): number {
  return POPUP_TITLE_HEIGHT + rows * cardHeight + Math.max(0, rows - 1) * gap;
}

function overlapRowLayout(
  safeCount: number,
  cardWidth: number,
  cardHeight: number,
  inner: number,
  gap: number
): PopupSectionLayout {
  const stepX = safeCount <= 1 ? 0 : (inner - cardWidth) / (safeCount - 1);
  return {
    columns: safeCount,
    rows: 1,
    stepX,
    stepY: cardHeight + gap,
    width: POPUP_PADDING * 2 + inner,
    height: sectionHeight(cardHeight, gap, 1),
    overlap: true
  };
}

function multiRowLayout(
  safeCount: number,
  cardWidth: number,
  cardHeight: number,
  rowInner: number,
  gap: number
): PopupSectionLayout {
  const columns = POPUP_MAX_ROW_CARDS;
  const rows = Math.ceil(safeCount / columns);
  const spacedRowInner = columns * cardWidth + Math.max(0, columns - 1) * gap;
  if (spacedRowInner <= rowInner) {
    return {
      columns,
      rows,
      stepX: cardWidth + gap,
      stepY: cardHeight + gap,
      width: POPUP_PADDING * 2 + spacedRowInner,
      height: sectionHeight(cardHeight, gap, rows),
      overlap: false
    };
  }
  const stepX = columns <= 1 ? 0 : (rowInner - cardWidth) / (columns - 1);
  return {
    columns,
    rows,
    stepX,
    stepY: cardHeight + gap,
    width: POPUP_PADDING * 2 + rowInner,
    height: sectionHeight(cardHeight, gap, rows),
    overlap: true
  };
}

/**
 * 弹层牌区：不超过 10 张时单行，行宽不超过约 5 张，再多叠放；超过 10 张则按行换行。
 */
export function layoutPopupSection(
  count: number,
  cardWidth: number,
  cardHeight: number,
  availableWidth: number
): PopupSectionLayout {
  const safeCount = Math.max(1, count);

  if (safeCount <= POPUP_MAX_ROW_CARDS) {
    const rowInner = popupSingleRowInnerLimit(cardWidth, availableWidth);
    const gap = POPUP_CARD_GAP;
    const fullRowInner = safeCount * cardWidth + Math.max(0, safeCount - 1) * gap;
    if (safeCount <= 1) {
      return {
        columns: 1,
        rows: 1,
        stepX: 0,
        stepY: cardHeight + gap,
        width: POPUP_PADDING * 2 + cardWidth,
        height: sectionHeight(cardHeight, gap, 1),
        overlap: false
      };
    }
    if (fullRowInner <= rowInner) {
      return {
        columns: safeCount,
        rows: 1,
        stepX: cardWidth + gap,
        stepY: cardHeight + gap,
        width: POPUP_PADDING * 2 + fullRowInner,
        height: sectionHeight(cardHeight, gap, 1),
        overlap: false
      };
    }
    const compactGap = POPUP_CARD_GAP_COMPACT;
    const compactRowInner = safeCount * cardWidth + Math.max(0, safeCount - 1) * compactGap;
    if (compactRowInner <= rowInner) {
      return {
        columns: safeCount,
        rows: 1,
        stepX: cardWidth + compactGap,
        stepY: cardHeight + compactGap,
        width: POPUP_PADDING * 2 + compactRowInner,
        height: sectionHeight(cardHeight, compactGap, 1),
        overlap: false
      };
    }
    return overlapRowLayout(safeCount, cardWidth, cardHeight, rowInner, compactGap);
  }

  const rowInner = popupSingleRowInnerLimit(cardWidth, availableWidth);
  return multiRowLayout(safeCount, cardWidth, cardHeight, rowInner, POPUP_CARD_GAP_COMPACT);
}

export function popupCardPosition(
  index: number,
  layout: PopupSectionLayout,
  sectionTop: number
): { x: number; y: number } {
  const col = layout.columns > 0 ? index % layout.columns : 0;
  const row = layout.columns > 0 ? Math.floor(index / layout.columns) : 0;
  return {
    x: POPUP_PADDING + col * layout.stepX,
    y: sectionTop + POPUP_TITLE_HEIGHT + row * layout.stepY
  };
}
