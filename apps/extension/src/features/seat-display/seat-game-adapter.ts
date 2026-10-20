/**
 * 座位与游戏对象适配：从场景座位实例读取手牌/身份等字段。
 */

import { resolveGameMode, type SeatStateSnapshot } from './seat-state.ts';

/** 游戏对象只在运行时存在，因此适配层只描述迁移所需的最小只读结构。 */
export interface GameSceneSeatSource {
  SelfSeatUi?: unknown;
  width?: number;
  height?: number;
  mySeats?: unknown[];
  isGuoZhan?: boolean;
  isDouDiZhu?: boolean;
  isShanHeTu?: boolean;
  isRoguelike1v1?: boolean;
  isSWJG?: boolean;
  seatContainer?: {
    seatUIs?: unknown[];
  };
}

type UnknownRecord = Record<string, unknown>;

// 实机座位对象没有 seatID 字段，座位号在 index/Index。
const SEAT_ID_KEYS = ['seatID', 'seatId', 'SeatID', 'SeatId', 'index', 'Index', 'id', 'ID'] as const;
const ORDER_KEYS = ['order', 'seatOrder', 'displayOrder', 'Order'] as const;
const PLAYER_NAME_KEYS = ['playerName', 'name', 'Name', 'nickName', 'NickName'] as const;
const CARD_LIST_KEYS = ['knownCards', 'handCards', 'HandCards', 'cards', 'Cards'] as const;
const SHOWN_HAND_CARD_KEYS = ['HandShowCards', 'handShowCards'] as const;
const SHOWN_HAND_CARD_ID_KEYS = ['HandShowCardIDs', 'handShowCardIDs'] as const;
const CARD_UI_LIST_KEYS = ['cardUis', 'cardUIs', 'handCardUis', 'handCardUIs'] as const;
const EQUIP_CARD_UI_LIST_KEYS = ['equipCardUis', 'equipCardUIs'] as const;
const CARD_ID_KEYS = ['cardId', 'cardID', 'CardId', 'CardID', 'id', 'ID', 'key'] as const;
const CARD_NAME_KEYS = ['name', 'Name', 'cardName'] as const;
const HAND_COUNT_KEYS = ['handCardCount', 'cardCount', 'HandCardCount'] as const;
const CARD_TAG_KEYS = ['TagArr1', 'tagArr1'] as const;

/**
 * 把游戏拥有的座位对象翻译为小抄快照。
 *
 * 不保留游戏对象引用，也不向对象写值；游戏版本缺少某个字段时使用安全默认值，
 * 后续可以按实机观察逐项补充字段别名，而不用污染 Vue 组件。
 */
export function readSeatStateFromGameScene(
  gameScene: GameSceneSeatSource | null
): Partial<SeatStateSnapshot> {
  const rawSeatUIs = gameScene?.seatContainer?.seatUIs;
  if (!Array.isArray(rawSeatUIs) || rawSeatUIs.length === 0) {
    return { inGame: false };
  }

  const controlledSeatIds = readControlledSeatIds(gameScene, rawSeatUIs);
  const seats = rawSeatUIs.flatMap((rawSeatUI, index) => {
    const seatUI = asRecord(rawSeatUI);
    const seat = asRecord(seatUI?.seat) ?? seatUI;
    if (!seat) return [];
    const seatId = readSeatId(seat, SEAT_ID_KEYS)
      ?? readSeatId(seatUI, SEAT_ID_KEYS);
    if (seatId === null) return [];

    // 2v2 的 mySeats/controlledSeatIds 会同时包含自己和队友。队友的手牌可以作为
    // 确定牌读取，但不能因此标成“自己”，否则明牌条会把队友座位过滤掉。
    const isSelf = rawSeatUI === gameScene?.SelfSeatUi
      || (readBoolean(seat, ['isSelf', 'IsSelf']) ?? false);
    const isControlled = isSelf || controlledSeatIds.includes(seatId);
    const seatCards = readArray(seat, CARD_LIST_KEYS);
    const shownHandCards = readShownHandEntries(seat, seatUI);
    const cardContainer = asRecord(seatUI?.cardContainer);
    const visibleCardUIs = readArray(cardContainer, CARD_UI_LIST_KEYS);
    const equipCardUIs = [
      ...readArray(cardContainer, EQUIP_CARD_UI_LIST_KEYS),
      ...readArray(seatUI, EQUIP_CARD_UI_LIST_KEYS)
    ];
    const equipmentCards = [...new Set(equipCardUIs)]
      .flatMap((rawCard) => readKnownCard(rawCard))
      .map((card) => ({ ...card, hints: equipmentHints(card.name) }));
    const equipmentIds = new Set(equipmentCards.map((card) => card.cardId));
    // 其他玩家的 HandCards / 背面 CardUi 常残留上一局卡号，不能当明牌。
    // 对手只读官方公开数组；确定牌还来自明牌引擎的移动记录。
    // 装备区牌已经在座位装备栏可见，不得并入已知手牌。
    const publicCardUIs = visibleCardUIs.filter((rawCard) => isPubliclyShownCard(rawCard));
    const shownCards = [...shownHandCards, ...publicCardUIs]
      .flatMap((rawCard) => readKnownCard(rawCard))
      .filter((card) => !equipmentIds.has(card.cardId));
    // 2v2 队友的 HandCards 是确定牌，但调用 SetCardUIRemark 会连带触发技能
    // 文字图层（例如神典韦错误出现“克己”）。私有手牌只读卡号与已有标签。
    let privateCards = (isControlled ? seatCards : [])
      .flatMap((rawCard) => readKnownCard(rawCard))
      .filter((card) => !equipmentIds.has(card.cardId));
    // 浏览器端 HandShowCards / HandShowCardIDs 可能滞后于真实手牌，不能用它的长度
    // 推算手牌数；优先读游戏计数，其次读座位当前实际渲染的手牌组件数量。
    const handCardCount = readSeatHandCardCount(seat, seatUI)
      ?? (isControlled ? privateCards.length : seatCards.length);
    // 手牌张数已是 0 时丢掉残留的私有手牌。观星等公开牌不在手牌张数里，不能一起清掉。
    if (handCardCount === 0) privateCards = [];
    // HandShowCards / HandShowCardIDs 也会短暂残留；手牌总数归零后，
    // 这些条目已不可能仍属于手牌，否则明牌条会在手牌打空后继续显示旧牌。
    const knownCards = handCardCount === 0
      ? []
      : uniqueCards([...privateCards, ...shownCards]).slice(0, handCardCount);

    return [{
      seatId,
      displayOrder: readPositiveInteger(seatUI, ORDER_KEYS)
        ?? readPositiveInteger(seat, ORDER_KEYS)
        ?? index + 1,
      playerName: readString(seat, PLAYER_NAME_KEYS),
      // 旁观模式下数组首项也不是自己，不能用排列位置推断本家。
      isSelf,
      isAlive: !(readBoolean(seat, ['isDead', 'IsDead']) ?? false),
      anchor: readSeatAnchor(seatUI, gameScene),
      knownCards,
      equipmentCards,
      unknownCardCount: Math.max(0, handCardCount - knownCards.length)
    }];
  });
  const selfSeat = seats.find((seat) => seat.isSelf);

  return {
    inGame: seats.length > 0,
    isSpectating: !selfSeat,
    selfSeatId: selfSeat?.seatId ?? null,
    controlledSeatIds: controlledSeatIds.length
      ? controlledSeatIds
      : selfSeat ? [selfSeat.seatId] : [],
    mode: resolveGameMode({
      spectating: !selfSeat,
      nationWar: gameScene?.isGuoZhan === true,
      doudizhu: gameScene?.isDouDiZhu === true,
      shanhetu: gameScene?.isShanHeTu === true,
      rogue1v1: gameScene?.isRoguelike1v1 === true,
      swjg: gameScene?.isSWJG === true
    }),
    seats
  };
}

function uniqueCards(cards: { cardId: number; name: string; tags: string[] }[]): { cardId: number; name: string; tags: string[] }[] {
  const seen = new Set<number>();
  return cards.filter((card) => {
    if (seen.has(card.cardId)) return false;
    seen.add(card.cardId);
    return true;
  });
}

/**
 * 有牌面就只用当前牌面。
 * 卡号列表只增不减，拼点或摸牌时叠上去会把以前亮过的牌再记进明牌。
 * 没有牌面时才读卡号，观星这类展示经常只有卡号。
 */
export function readShownHandEntries(
  seat: UnknownRecord | null,
  seatUi: UnknownRecord | null = null
): unknown[] {
  const cards = [
    ...readArray(seat, SHOWN_HAND_CARD_KEYS),
    ...readArray(seatUi, SHOWN_HAND_CARD_KEYS)
  ].filter((rawCard) => readBoolean(asRecord(rawCard), ['IsHide', 'isHide']) !== true);
  if (cards.length > 0) return cards;
  return [
    ...readArray(seat, SHOWN_HAND_CARD_ID_KEYS),
    ...readArray(seatUi, SHOWN_HAND_CARD_ID_KEYS)
  ];
}

/** 返回场景能确认的实际手牌张数；没有可靠来源时返回 null。 */
export function readSeatHandCardCount(
  seat: UnknownRecord | null,
  seatUi: UnknownRecord | null = null
): number | null {
  const cardContainer = asRecord(seatUi?.cardContainer);
  const explicitCount = readNonNegativeInteger(seat, HAND_COUNT_KEYS)
    ?? readNonNegativeInteger(seatUi, HAND_COUNT_KEYS)
    ?? readNonNegativeInteger(cardContainer, HAND_COUNT_KEYS);
  if (explicitCount !== null) return explicitCount;

  // cardUis 是当前座位手牌区正在显示的组件列表，能反映出牌、摸牌后的实际张数。
  for (const record of [cardContainer, seatUi]) {
    if (!record) continue;
    for (const key of CARD_UI_LIST_KEYS) {
      if (Array.isArray(record[key])) return (record[key] as unknown[]).length;
    }
  }
  return null;
}

function equipmentHints(name: string): string[] {
  return name.includes('阴风甲') ? ['阴风甲'] : [];
}

function readControlledSeatIds(scene: GameSceneSeatSource, rawSeatUIs: unknown[] = []): number[] {
  const sceneRecord = asRecord(scene);
  const values = Array.isArray(scene.mySeats)
    ? scene.mySeats
    : readArray(sceneRecord, ['MySeats', 'controlledSeats']);
  const ids = values.flatMap((value) => {
    const record = asRecord(value);
    const seatId = record ? readSeatId(record, SEAT_ID_KEYS) : Number(value);
    return Number.isInteger(seatId) && Number(seatId) >= 0 && Number(seatId) < 0xff
      ? [Number(seatId)] : [];
  });
  // 部分2v2排位版本不提供 gameScene.mySeats，只在座位对象上标记友方。
  // 把明确的友方座位并入可读取座位，不能用四人座次盲猜，以免泄露身份局手牌。
  for (const rawSeatUI of rawSeatUIs) {
    const seatUI = asRecord(rawSeatUI);
    const seat = asRecord(seatUI?.seat) ?? seatUI;
    if (!seat) continue;
    const friendly = readBoolean(seat, [
      'isFriend', 'IsFriend', 'isTeammate', 'IsTeammate', 'isTeamMate', 'IsTeamMate'
    ]) ?? readBoolean(seatUI, [
      'isFriend', 'IsFriend', 'isTeammate', 'IsTeammate', 'isTeamMate', 'IsTeamMate'
    ]);
    if (friendly !== true) continue;
    const seatId = readSeatId(seat, SEAT_ID_KEYS) ?? readSeatId(seatUI, SEAT_ID_KEYS);
    if (seatId !== null) ids.push(seatId);
  }
  return [...new Set(ids)];
}

function isPubliclyShownCard(rawCard: unknown): boolean {
  const cardUI = asRecord(rawCard);
  const card = asRecord(cardUI?.card)
    ?? asRecord(cardUI?.Card)
    ?? asRecord(cardUI?.cardInfo)
    ?? cardUI;
  if (!cardUI && !card) return false;
  const hidden = readBoolean(cardUI, ['IsHide', 'isHide', 'isBack', 'IsBack', 'back'])
    ?? readBoolean(card, ['IsHide', 'isHide', 'isBack', 'IsBack', 'back']);
  if (hidden === true) return false;
  const shown = readBoolean(cardUI, ['isShow', 'IsShow', 'isFront', 'IsFront'])
    ?? readBoolean(card, ['isShow', 'IsShow', 'isFront', 'IsFront']);
  if (shown === false) return false;
  return readPositiveInteger(card, CARD_ID_KEYS) !== null;
}
function readKnownCard(rawCard: unknown) {
  if (Number.isInteger(Number(rawCard)) && Number(rawCard) > 0) {
    return [{ cardId: Number(rawCard), name: '', tags: [] }];
  }
  const cardUI = asRecord(rawCard);
  const card = asRecord(cardUI?.card)
    ?? asRecord(cardUI?.Card)
    ?? asRecord(cardUI?.cardInfo)
    ?? cardUI;
  const cardId = readPositiveInteger(card, CARD_ID_KEYS);
  return cardId === null ? [] : [{
    cardId,
    name: readString(card, CARD_NAME_KEYS),
    tags: [...new Set([
      ...readStringArray(cardUI, CARD_TAG_KEYS),
      ...readStringArray(card, CARD_TAG_KEYS)
    ])]
  }];
}

function readSeatAnchor(seatUI: UnknownRecord, scene: GameSceneSeatSource): object | null {
  const width = readFiniteNumber(seatUI, ['width', 'Width', 'displayWidth']);
  const height = readFiniteNumber(seatUI, ['height', 'Height', 'displayHeight']);
  if (!(width > 0 && height > 0)) return null;
  let x = 0;
  let y = 0;
  let scaleX = 1;
  let scaleY = 1;
  let node: UnknownRecord | null = seatUI;
  let depth = 0;
  while (node && depth++ < 12) {
    x += (readFiniteNumber(node, ['x', '_x']) || 0) * scaleX;
    y += (readFiniteNumber(node, ['y', '_y']) || 0) * scaleY;
    scaleX *= readFiniteNumber(node, ['scaleX', '_scaleX']) || 1;
    scaleY *= readFiniteNumber(node, ['scaleY', '_scaleY']) || 1;
    node = asRecord(node.parent);
  }
  const stageWidth = readFiniteNumber(asRecord(scene), ['width', 'Width', 'designWidth'])
    || readFiniteNumber(asRecord((globalThis as UnknownRecord).Laya)?.stage as UnknownRecord, ['width'])
    || 1920;
  const stageHeight = readFiniteNumber(asRecord(scene), ['height', 'Height', 'designHeight'])
    || readFiniteNumber(asRecord((globalThis as UnknownRecord).Laya)?.stage as UnknownRecord, ['height'])
    || 1080;
  return { x, y, width: width * scaleX, height: height * scaleY, stageWidth, stageHeight };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function readArray(record: UnknownRecord | null, keys: readonly string[]): unknown[] {
  if (!record) return [];
  for (const key of keys) if (Array.isArray(record[key])) return record[key] as unknown[];
  return [];
}

function readString(record: UnknownRecord | null, keys: readonly string[]): string {
  if (!record) return '';
  for (const key of keys) if (typeof record[key] === 'string') return record[key] as string;
  return '';
}

function readStringArray(record: UnknownRecord | null, keys: readonly string[]): string[] {
  if (!record) return [];
  for (const key of keys) {
    if (!Array.isArray(record[key])) continue;
    return (record[key] as unknown[])
      .map((value) => String(value ?? '').trim())
      .filter(Boolean);
  }
  return [];
}

function readBoolean(record: UnknownRecord | null, keys: readonly string[]): boolean | null {
  if (!record) return null;
  for (const key of keys) if (typeof record[key] === 'boolean') return record[key] as boolean;
  return null;
}

function readPositiveInteger(record: UnknownRecord | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isInteger(value) && value > 0) return value;
  }
  return null;
}

function readSeatId(record: UnknownRecord | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isInteger(value) && value >= 0 && value < 0xff) return value;
  }
  return null;
}

function readNonNegativeInteger(record: UnknownRecord | null, keys: readonly string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isInteger(value) && value >= 0) return value;
  }
  return null;
}

function readFiniteNumber(record: UnknownRecord | null, keys: readonly string[]): number {
  if (!record) return 0;
  for (const key of keys) {
    const value = Number(record[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}
