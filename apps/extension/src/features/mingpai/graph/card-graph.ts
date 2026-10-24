/**
 * 牌位图：把「某一格里的牌」建模成可寻址的槽位链。
 *
 * 每个槽位有一个 key：
 * - `> 0`：这一格已经知道是哪张牌（key 就是牌号）。
 * - `= 0`：未知格子，界面上显示「？」。
 * - `< 0 且为奇数`：一组内容可以枚举的槽位（明组）。
 * - `< 0 且为偶数`：一组看不见内容的槽位（暗组）。
 *
 * 槽位还有 id（这一格的牌号，未知时是占位）、zone（所属区域）以及 next / prev
 * 组成的双向链。链上任意一段可以整组打包（pack）成一格、之后再解开（unpack）。
 *
 * 模块级状态对应整局共享的槽位表：所有区域共用一份 nodes / groups / LABELs。
 * 视图渲染通过 hooks 回调外置，本文件不碰 DOM。
 */

/** 牌堆底：摸牌从数组尾部取。 */
export const DRAW_PILE_BOTTOM = 0;
/** 牌堆顶。 */
export const DRAW_PILE_TOP = 0xff00;
/** 位置未指定，只能靠牌号定位。 */
export const POSITION_UNSPECIFIED = 0xff02;

/** 收容未知槽位的区域名。 */
export const UNKNOWN_ZONE = 'unknown';
/** 全局 owner 编号，区域键里代表牌堆、弃牌堆这类公共区。 */
export const GLOBAL_OWNER = 0xff;
const DEFAULT_ZONE = `12-${GLOBAL_OWNER}`;
const DRAW_PILE_ZONE_ID = `1-${GLOBAL_OWNER}`;
const DISCARD_ZONE_ID = `2-${GLOBAL_OWNER}`;

/** 区域编号 0/1/2/3/9/12 配上 owner 0 时统一算公共区，owner 记为 255。 */
const PUBLIC_OWNER_ZONES = [0, 1, 2, 3, 9, 12];

/** 换到牌堆顶 / 底时按顺序取牌的技能号。 */
const DRAW_PILE_ORDER_SPELL_IDS = [3208, 7011, 987, 988, 3903];

export type CardSlotKey = number;
export type CardSlotZone = string;
export type CardSlotId = number | string;

export interface CardGraphClock {
  turn: number;
  round: number;
  phase: number;
}

export interface CardGraphHooks {
  /** 槽位需要重画时的挂点。 */
  onSlotChanged?: (slot: CardSlot) => void;
  /** 某个区域或 unknown 需要重画时的挂点。 */
  onZoneChanged?: (zoneId: string) => void;
  /** 牌名 / 花色 / 点数统计需要刷新时的挂点。 */
  onCountersChanged?: () => void;
  /** 读牌名，只用于调试输出。 */
  cardNameOf?: (cardId: number) => string;
}

/** 牌面对照信息，供计数器统计牌名 / 花色 / 点数 / 类型。 */
export interface CardFaceInfo {
  name: string;
  color: number;
  number: number;
  type: number;
}

let clock: CardGraphClock = { turn: 0, round: 0, phase: 0 };
let hooks: CardGraphHooks = {};

/** 下一次打包使用的槽位号，向下递减；NaN 表示还没开局。 */
let slotCounter = Number.NaN;
/** 槽位号 → 占用该号的所有槽位。 */
let slotsByKey = new Map<CardSlotKey, Set<CardSlot>>();

const mingpaiCardTags = new Map<number, string[]>();
const mingpaiPersistentCardTags = new Map<number, string[]>();
const officialHandCardsBySeat = new Map<number, Set<number>>();
const mingpaiQiOwnerByCard = new Map<number, number>();
const reshufflePoolKeys = new Set<number>();

/** 区域键 → 槽位集合。unknown 区域固定用 Set，其余区域用数组保持顺序。 */
let zoneStore = new Map<string, CardSlot[] | Set<CardSlot>>();

const QI_TAG = '炁';
/** 会跟着牌一直走下去的标签：牌离开手牌也不丢。 */
const STICKY_TAGS = new Set<string>([QI_TAG, '心幽', '椒遇']);

/** 顺手、火攻这类来源短名，形如「[顺手]」。牌还在手上时要能画出来，离开手牌就丢掉。 */
function isSourceHandLabel(tag: string): boolean {
  return /^\[[^\]]+\]/.test(String(tag ?? '').trim());
}

export function setCardGraphClock(next: Partial<CardGraphClock>): void {
  clock = { ...clock, ...next };
}

export function setCardGraphHooks(next: CardGraphHooks): void {
  hooks = { ...hooks, ...next };
}

export function getCardGraphClock(): Readonly<CardGraphClock> {
  return clock;
}

/** 一组内容可枚举的槽位（奇数 key）。 */
export function isOpenGroupKey(key: number): boolean {
  return key < 0 && key % 2 !== 0;
}

/** 一组看不见内容的槽位（偶数 key，含 0）。 */
export function isHiddenGroupKey(key: number): boolean {
  return key <= 0 && key % 2 === 0;
}

export function isCardGraphReady(): boolean {
  return !Number.isNaN(slotCounter);
}

/** 下一个打包用的槽位号。 */
export function peekSlotCounter(): number {
  return slotCounter;
}

export function getSlotsByKey(key: number): CardSlot[] {
  const set = slotsByKey.get(key);
  return set ? [...set] : [];
}

export function filterSlots(predicate: (slot: CardSlot) => unknown = Boolean): CardSlot[] {
  const result: CardSlot[] = [];
  for (const set of slotsByKey.values()) {
    for (const slot of set) if (predicate(slot)) result.push(slot);
  }
  return result;
}

export class CardSlot {
  _key: CardSlotKey;
  zone: CardSlotZone;
  id: CardSlotId;
  next: CardSlot | null;
  prev: CardSlot | null;
  /** 进区时协议给的位置，只用于查询，不参与算法。 */
  position = 0;
  /**
   * 这张明牌是放在牌堆顶还是牌堆底。
   * 牌堆里只有这几张时，不能既算顶又算底。
   */
  pileEdge: '' | 'top' | 'bottom' = '';
  /** 进区时协议给的区域参数，只用于查询，不参与算法。 */
  zoneParam = 0;

  constructor(
    key: CardSlotKey,
    id: CardSlotId | null = null,
    zone: CardSlotZone = DEFAULT_ZONE,
    next: CardSlot | null = null,
    prev: CardSlot | null = null
  ) {
    this._key = key;
    this.zone = zone;
    this.id = id ?? key;
    this.next = next;
    this.prev = prev;
    let set = slotsByKey.get(key);
    if (!set) {
      set = new Set();
      slotsByKey.set(key, set);
    }
    set.add(this);
  }

  get head(): CardSlot {
    let node: CardSlot = this;
    while (node.prev) node = node.prev;
    return node;
  }

  get end(): CardSlot {
    let node: CardSlot = this;
    while (node.next) node = node.next;
    return node;
  }

  get key(): CardSlotKey {
    return this._key;
  }

  set key(value: CardSlotKey) {
    if (this._key === value) return;
    slotsByKey.get(this._key)?.delete(this);
    this._key = value;
    let set = slotsByKey.get(value);
    if (!set) {
      set = new Set();
      slotsByKey.set(value, set);
    }
    set.add(this);
  }

  toString(): string {
    if (this.next) {
      const tail = this.next.toString();
      return this.prev ? `${this.key}<${tail}` : `${this.zone}:${this.key}<${tail}`;
    }
    const name = this.key > 0 ? hooks.cardNameOf?.(Number(this.id)) ?? String(this.id) : '？';
    return `[${this.id}]${name}`;
  }

  /** 视图刷新挂点；槽位本身的状态不在这里改。 */
  plot(_force?: boolean): void {
    hooks.onSlotChanged?.(this);
  }

  /** 与另一槽位交换 key / id / 后继，并把 id 沿两侧链同步下去。 */
  swap(other: CardSlot | null | undefined): this {
    if (!other || other === this) return this;
    [this.key, other.key] = [other.key, this.key];
    [this.id, other.id] = [other.id, this.id];
    [this.next, other.next] = [other.next, this.next];
    if (this.next) this.next.prev = this;
    if (other.next) other.next.prev = other;
    let node = other;
    while (node.prev && node.prev.id !== node.id) {
      node.prev.id = node.id;
      node = node.prev;
    }
    node.plot(true);
    drawZone(node.zone);
    node = this;
    while (node.prev && node.prev.id !== node.id) {
      node.prev.id = node.id;
      node = node.prev;
    }
    node.plot(true);
    drawZone(node.zone);
    return this;
  }

  /** 在当前槽位之后插入一格新槽位，并把当前槽位改到新 key 上。 */
  create(key: CardSlotKey): this {
    const inserted = new CardSlot(this.key, this.id, this.zone, this.next, this);
    this.key = key;
    if (this.next) this.next.prev = inserted;
    this.next = inserted;
    return this;
  }

  /**
   * 把当前槽位吸收掉它的后继。
   * 返回值表示 unknown 区域的成员是否发生了变化。
   */
  delete(): boolean | null {
    if (this.next) {
      const next = this.next;
      this.key = next.key;
      this.id = next.id;
      this.next = next.next;
      let changed = false;
      if (next.next) next.next.prev = this;
      else if (unknownZoneSlots().delete(next)) {
        changed = true;
        if (this.prev) unknownZoneSlots().add(this);
      }
      slotsByKey.get(next.key)?.delete(next);
      return changed;
    }
    if (this.key === 0) {
      this.key = this.id as number;
      cardCounter.counter(this.id as number, this.key);
      return true;
    }
    return null;
  }

  /** 清掉这一格所在的组，落回具体牌号或占位 id。 */
  destroy(target?: number | null): this {
    let changed = false;
    let key = this.key;
    while (key < 0) {
      if (this.delete()) changed = true;
      if (unpackSlots(key)) changed = true;
      key = this.key;
    }
    if (this.key != target) {
      this.key = target ?? (this.id as number);
      cardCounter.counter(this.id as number, this.key);
    }
    if (this.prev) unpackSlots(this.prev.key);
    else {
      this.plot(true);
      drawZone(this.zone);
    }
    if (changed) drawZone(UNKNOWN_ZONE);
    return this;
  }

  /**
   * 把这一格认成牌号 id，必要时先顺着链找到真正持有该牌的槽位再换过来。
   * 认不出来时降级为未知，仍失败则报错返回 null。
   */
  identify(id: CardSlotId, newId: number | null = null): this | null {
    if (this.id == id) {
      if (!(this.key > 0)) {
        if (newId) this.end.id = newId;
        this.destroy();
      }
      return this;
    }
    let found: CardSlot | undefined;
    const visitedKeys = new Set<CardSlotKey>([this.key]);
    const queue: Array<[CardSlotKey, CardSlot[]]> = [[this.key, []]];
    while (queue.length > 0) {
      const [key, path] = queue.shift() as [CardSlotKey, CardSlot[]];
      found = findSlot(key, id);
      if (found) {
        path.concat(found).reduce((acc, node) => acc.swap(node).next as CardSlot, this);
        break;
      }
      for (const node of getSlotsByKey(key).filter((entry) => entry.next)) {
        const nextKey = (node.next as CardSlot).key;
        if (!visitedKeys.has(nextKey)) {
          visitedKeys.add(nextKey);
          queue.push([nextKey, path.concat(node)]);
        }
      }
    }
    if (found) {
      if (newId) {
        let node: CardSlot = this;
        for (node.id = newId; node.next; ) {
          node = node.next;
          node.id = newId;
        }
      }
      this.destroy();
      return this;
    }
    if (Number(id) > 0) return this.identify(0, Number(id));
    return null;
  }
}

/** 把若干槽位整组打包成一格，返回这一格的 key。 */
export function packSlots(
  cards: readonly CardSlot[] | null | undefined,
  hide?: boolean,
  mode?: number
): number {
  if (!(cards && cards.length > 1) || !cards.every(Boolean)) return cards?.[0]?.key ?? 0;
  const keys = new Set(cards.map((card) => card.key));
  if (keys.size === 1) return [...keys][0];
  slotCounter -= 1;
  let groupKey: number;
  if (mode) {
    if (new Set(cards.map((card) => card.head.zone)).size === 1) return 0;
    const negativeKeys = [...slotsByKey.keys()].filter((key) => key < 0);
    groupKey = 0;
    for (let slot = 0; slot >= slotCounter; slot -= 1) {
      if (!negativeKeys.includes(slot * 2 - 1) && !negativeKeys.includes(slot * 2 - 2)) {
        groupKey = slot * 2 - mode;
        break;
      }
    }
    const shifted = negativeKeys.filter((key) => key > groupKey);
    const pooled = shifted.filter((key) => reshufflePoolKeys.has(key));
    pooled.forEach((key) => reshufflePoolKeys.delete(key));
    pooled.forEach((key) => reshufflePoolKeys.add(key - 2));
    shifted.sort((left, right) => left - right).forEach((key) => {
      getSlotsByKey(key).forEach((slot) => {
        slot.key = slot.key - 2;
        slot.head.plot(true);
      });
    });
    groupKey = -mode;
    reshufflePoolKeys.add(groupKey);
  } else {
    groupKey = slotCounter * 2 - (hide ? 2 : 1);
  }
  cards.forEach((card) => {
    card.create(groupKey);
    unknownZoneSlots().delete(card);
    if (!hide) unknownZoneSlots().add(card.end);
  });
  drawZone(UNKNOWN_ZONE);
  return groupKey;
}

/** 解散一个组。牌堆里的组永不解散。 */
export function unpackSlots(key: CardSlotKey): boolean {
  if (key > 0) return true;
  const list = getSlotsByKey(key);
  const nextKeys = new Set(list.map((slot) => slot.next?.key));
  const zones = new Set(list.map((slot) => slot.head.zone));
  const dissolvable = list.length === 1
    || (!zones.has(DRAW_PILE_ZONE_ID) && (zones.size === 1 || (nextKeys.size === 1 && key !== 0)));
  if (!dissolvable) return false;
  reshufflePoolKeys.delete(key);
  const changed = list.map((slot) => slot.delete()).some(Boolean);
  [...new Set(list.filter((slot) => slot.prev).map((slot) => (slot.prev as CardSlot).key))]
    .forEach((prevKey) => unpackSlots(prevKey));
  list.filter((slot) => !slot.prev).forEach((slot) => slot.plot(true));
  [...zones].forEach((zone) => drawZone(zone));
  return changed;
}

/** 在某个 key 下找牌号为 id 的槽位；找不到时尝试从 key 0 挪过来。 */
export function findSlot(key: CardSlotKey, id: CardSlotId): CardSlot | undefined {
  let slot = getSlotsByKey(key).find((entry) => entry.id == id);
  if (slot === undefined && key !== 0) {
    const atZero = getSlotsByKey(0).find((entry) => entry.id == id);
    if (atZero) {
      slot = getSlotsByKey(key).find((entry) => entry.end.key === 0);
      if (slot !== undefined) atZero.swap(slot.end);
    }
  }
  return slot;
}

/** 展开一组 key 里能确定的具体牌号。 */
export function findSlotIds(
  key: CardSlotKey,
  includeHidden = false,
  keys: Set<number> = new Set(),
  visited: Set<CardSlotKey> = new Set()
): number[] {
  visited.add(key);
  if (key > 0 || (!includeHidden && key === 0)) keys.add(key);
  else if (includeHidden || key % 2 !== 0) {
    getSlotsByKey(key).forEach((slot) => {
      if (slot.next) {
        const nextKey = slot.next.key;
        if (!visited.has(nextKey)) findSlotIds(nextKey, includeHidden, keys, visited);
      } else if (includeHidden) keys.add(slot.id as number);
    });
  }
  return [...keys];
}

export interface SlotLookupResult {
  keys: number[];
  zones: string[];
}

/** 按槽位或牌号查出它可能属于哪些区域。 */
export function findSlotZones(
  input: CardSlot | number,
  includeHidden = false,
  keys: Set<number> = new Set(),
  zones: Set<string> = new Set()
): SlotLookupResult {
  let slot: CardSlot | undefined = input instanceof CardSlot ? input : undefined;
  if (!slot && typeof input === 'number' && input > 0) slot = getSlotsByKey(input)[0];
  if (!slot) {
    const needle = typeof input === 'number' ? input : Number.NaN;
    slot = getSlotsByKey(0).find((entry) => entry.id == needle);
  }
  if (slot) {
    if (!includeHidden && slot.key <= 0 && slot.key % 2 === 0) {
      zones.add('?');
      keys.add(slot.key);
    } else {
      zones.add(slot.head.zone);
      if (!keys.has(slot.key)) {
        keys.add(slot.key);
        if (slot.key <= 0 && (includeHidden || slot.key % 2 !== 0)) {
          getSlotsByKey(slot.key).forEach((entry) => {
            if (entry !== slot) findSlotZones(entry, includeHidden, keys, zones);
          });
        }
      }
      if (slot.prev) findSlotZones(slot.prev, includeHidden, keys, zones);
    }
  }
  return { keys: [...keys], zones: [...zones] };
}

/** 区域键由区域编号和 owner 拼成。 */
export function formatZoneId(ownerId: number | string, zone: number): string {
  return `${zone}-${ownerId}`;
}

/** 把区域键拆回区域编号和 owner。 */
export function parseZoneId(zoneId: string): { zone: number; ownerId: number } | null {
  const match = /^(\d+)-(\d+)$/.exec(zoneId);
  if (!match) return null;
  return { zone: Number(match[1]), ownerId: Number(match[2]) };
}

function drawZone(zoneId: string): void {
  hooks.onZoneChanged?.(zoneId);
}

/** 外部要求重画某个区域时的入口。 */
export function refreshZone(zoneId: string): void {
  drawZone(zoneId);
}

function unknownZoneSlots(): Set<CardSlot> {
  const existing = zoneStore.get(UNKNOWN_ZONE);
  if (existing instanceof Set) return existing;
  const created = new Set<CardSlot>();
  zoneStore.set(UNKNOWN_ZONE, created);
  return created;
}

function zoneCards(zoneId: string): CardSlot[] {
  const existing = zoneStore.get(zoneId);
  if (Array.isArray(existing)) return existing;
  if (existing instanceof Set) return [...existing];
  const created: CardSlot[] = [];
  zoneStore.set(zoneId, created);
  return created;
}

/** 现存的全部区域键。 */
export function getZoneIds(): string[] {
  return [...zoneStore.keys()];
}

/**
 * 可原地修改的区域数组。
 * unknown 区是 Set，不属于数组型区域，返回一个临时数组避免被误改。
 */
export function getMutableZoneCards(zoneId: string): CardSlot[] {
  const existing = zoneStore.get(zoneId);
  if (Array.isArray(existing)) return existing;
  if (existing instanceof Set) return [];
  const created: CardSlot[] = [];
  zoneStore.set(zoneId, created);
  return created;
}

/** unknown 区的成员集合。 */
export function getUnknownZoneSlots(): Set<CardSlot> {
  return unknownZoneSlots();
}

/** 一个区域里的槽位集合，负责把移入 / 移出翻译成槽位的认牌与打包。 */
export class CardZone {
  zoneID: string;
  zone: string;
  id: CardSlotId;
  pos: number;
  count: number | null;

  /** 牌堆里出现过的牌号并集。 */
  static get paidui(): number[] {
    return [...new Set([
      ...getSlotsByKey(0).map((slot) => slot.id as number),
      ...zoneCards(DRAW_PILE_ZONE_ID).map((slot) => slot.id as number)
    ])];
  }

  /** 弃牌堆里已经确认牌面的牌号。 */
  static get qipai(): number[] {
    return zoneCards(DISCARD_ZONE_ID).filter((slot) => slot.key > 0).map((slot) => slot.id as number);
  }

  /** 仍未知内容的槽位牌号（含占位）。 */
  static get unknown(): number[] {
    return getSlotsByKey(0).map((slot) => slot.id as number);
  }

  /** 某座位手牌里已经确认牌面的牌号。同一张牌只算一次。 */
  static shoupai(seatId: number | string): number[] {
    const ids = zoneCards(formatZoneId(seatId, 5))
      .filter((slot) => slot.key > 0)
      .map((slot) => Number(slot.id))
      .filter((cardId) => cardId > 0);
    return [...new Set(ids)];
  }

  constructor(
    idOrZoneId: number | string,
    zone = 5,
    pos = DRAW_PILE_TOP,
    count: number | null = null,
    zoneParam: number | null = null,
    extra: number | null = null
  ) {
    if (typeof idOrZoneId === 'number') {
      this.id = idOrZoneId;
      this.zone = String(zone);
      if (this.id === 0 && PUBLIC_OWNER_ZONES.includes(zone)) this.id = GLOBAL_OWNER;
      if (zone === 9) this.zone = '1';
      if (zone === 4) this.id = `${this.id}-${extra || zoneParam || 0}`;
      if (zone === 8) this.id = `-${zoneParam || extra || 0}`;
      this.zoneID = `${this.zone}-${this.id}`;
    } else {
      const text = String(idOrZoneId);
      const match = /(.*?)-(.*)/.exec(text);
      if (match) {
        this.zoneID = match[0];
        this.zone = match[1];
        this.id = match[2];
      } else {
        this.zoneID = text;
        this.zone = text;
        this.id = '';
      }
    }
    if (!zoneStore.has(this.zoneID)) zoneStore.set(this.zoneID, []);
    if (Number(this.zone) === 1) {
      this.pos = pos === DRAW_PILE_TOP ? DRAW_PILE_BOTTOM : pos === DRAW_PILE_BOTTOM ? DRAW_PILE_TOP : pos;
    } else if (Number(this.zone) === 10) {
      this.pos = pos;
    } else {
      this.pos = POSITION_UNSPECIFIED;
    }
    this.count = count;
  }

  get cards(): CardSlot[] {
    return zoneCards(this.zoneID);
  }

  get length(): number {
    return this.cards?.length ?? 0;
  }

  get size(): number {
    return new Set((this.cards ?? []).map((slot) => slot.key)).size;
  }

  /** 这些牌在这一区里亮相：能对上槽位的直接认牌。 */
  show(cardIds: number | number[] = []): CardSlot[] {
    if (!isCardGraphReady()) return [];
    const ids = Array.isArray(cardIds) ? [...cardIds] : [cardIds];
    if (ids.filter((cardId) => cardId > 0).length === 0) return [];
    const result: CardSlot[] = [];
    const pending = [...ids];
    if (this.pos === DRAW_PILE_TOP) {
      result.push(...this.cards.slice(-ids.length)
        .map((slot) => slot.identify(pending.shift() as number) as CardSlot));
    } else if (this.pos !== POSITION_UNSPECIFIED) {
      result.push(...this.cards.slice(this.pos, this.pos + ids.length)
        .map((slot) => slot.identify(pending.shift() as number) as CardSlot));
    } else if (Number(this.zone) !== 1) {
      const hints = pending.map((cardId) => findSlotZones(cardId, true).keys);
      this.cards.slice().sort((left, right) => right.key - left.key).some((slot) => {
        if (pending.filter((cardId) => cardId > 0).length === 0) return true;
        hints.some((keys, index) => {
          if (!keys.includes(slot.key)) return false;
          const identified = slot.identify(pending[index]);
          if (!identified) return false;
          result[index] = identified;
          keys.length = 0;
          pending[index] = null as unknown as number;
          return true;
        });
        return false;
      });
      pending.forEach((cardId, index) => {
        if (!cardId) return;
        const matched = getSlotsByKey(cardId).find((slot) => !result.includes(slot));
        if (matched) {
          if (this.cards.includes(matched)) result[index] = matched.identify(cardId) as CardSlot;
          else {
            const spare = this.cards.find((slot) => !result.includes(slot));
            if (spare) {
              result[index] = spare.swap(matched)?.identify(cardId) as CardSlot;
              void cardId;
            }
          }
        }
        if (result[index] == null) {
          result[index] = this.cards.find((slot) => slot.id === 0 && !result.includes(slot))
            ?.identify(cardId) as CardSlot;
        }
        if (result[index] == null) {
          result[index] = this.cards.find((slot) => slot.key === 0 && !result.includes(slot))
            ?.identify(cardId) as CardSlot;
        }
        if (result[index] == null) {
          result[index] = new CardSlot(cardId, cardId, this.zoneID);
          void cardId;
        }
      });
    }
    drawZone(this.zoneID);
    return result;
  }

  /** 这些牌离开这一区。协议没给牌号时按位置顺序取。 */
  remove(cardIds: number | number[] = [], spellId?: number, count?: number): CardSlot[] {
    if (!isCardGraphReady()) return [];
    const ids = Array.isArray(cardIds) ? [...cardIds] : [cardIds];
    if (count) this.count = count;
    const taken: CardSlot[] = [];
    const pending = [...ids];
    if (this.pos === DRAW_PILE_TOP) {
      if (Number(this.zone) === 1) taken.push(...takeKnownBottom(this.cards, this.count as number, this.zoneID));
      else taken.push(...this.cards.splice(-(this.count as number)));
    } else if (Number(this.zone) === 1 && this.pos === DRAW_PILE_BOTTOM) {
      taken.push(...takeKnownTop(this.cards, this.count as number, this.zoneID));
    } else if (this.pos !== POSITION_UNSPECIFIED) {
      taken.push(...this.cards.splice(this.pos, this.count as number));
      if (Number(this.zone) === 1 && DRAW_PILE_ORDER_SPELL_IDS.includes(spellId as number)) taken.reverse();
    } else if (ids.filter((cardId) => cardId > 0).length > 0) {
      const hints = pending.map((cardId) => findSlotZones(cardId, true).keys);
      this.cards.slice().reverse().sort((left, right) => right.key - left.key).some((slot) => {
        if (pending.filter((cardId) => cardId > 0).length === 0) return true;
        hints.some((keys, index) => {
          if (!keys.includes(slot.key)) return false;
          taken[index] = this.cards.splice(this.cards.indexOf(slot), 1)[0];
          keys.length = 0;
          pending[index] = null as unknown as number;
          return true;
        });
        return false;
      });
      pending.forEach((cardId, index) => {
        if (!cardId) return;
        let unknownIndex = this.cards.findIndex((slot) => slot.id === 0);
        if (unknownIndex === -1) unknownIndex = this.cards.findIndex((slot) => slot.key === 0);
        const matched = getSlotsByKey(cardId).find((slot) => !taken.includes(slot));
        if (unknownIndex > -1) {
          taken[index] = this.cards.splice(unknownIndex, 1)[0];
          if (matched && matched !== taken[index]) {
            taken[index] = taken[index].swap(matched);
          }
        } else {
          const spareIndex = this.cards.findIndex((slot) => !taken.includes(slot));
          if (matched && spareIndex >= 0) {
            taken[index] = this.cards.splice(spareIndex, 1)[0]?.swap(matched) as CardSlot;
          } else {
            taken[index] = new CardSlot(cardId, cardId, this.zoneID);
          }
        }
      });
    } else if ((this.count as number) === this.length || this.size === 1) {
      taken.push(...this.cards.splice(0, this.count as number));
    } else if (Number(this.zone) === 1 || Number(this.zone) === 2) {
      let order = [
        ...this.cards.filter((slot) => slot.key <= 0).sort((left, right) => right.key - left.key),
        ...this.cards.filter((slot) => slot.key > 0)
      ];
      if ([11104, 3488, 862].includes(spellId as number)) {
        let allowed = new Set(order.map((slot) => slot.key));
        if (spellId === 11104) {
          allowed = new Set([...allowed].filter((key) => getSlotsByKey(key)
            .some((slot) => cardCounter.type[3]?.has(slot.id as number))));
        } else if (spellId === 3488) {
          allowed = new Set([...allowed].filter((key) => getSlotsByKey(key).some((slot) => (
            cardCounter.name['雷杀']?.has(slot.id as number)
            || cardCounter.name['火杀']?.has(slot.id as number)
            || cardCounter.name['冰杀']?.has(slot.id as number)
          ))));
        } else if (spellId === 862) {
          allowed = new Set([...allowed].filter((key) => getSlotsByKey(key)
            .some((slot) => cardCounter.number[6].has(slot.id as number))));
        }
        order = order.filter((slot) => allowed.has(slot.key));
      }
      taken.push(...order.slice(0, this.count as number));
      if (taken.some((slot) => slot.key > 0 || slot.key % 2)) packSlots(order, true);
      taken.forEach((slot) => this.cards.splice(this.cards.indexOf(slot), 1));
    } else {
      packSlots(this.cards);
      taken.push(...this.cards.splice(0, this.count as number));
    }
    while (taken.length !== this.count) {
      taken.push(new CardSlot(0, 0, this.zoneID));
    }
    if (ids.filter((cardId) => cardId > 0).length === this.count) {
      ids.forEach((cardId, index) => {
        const slot = taken[index];
        if (slot == null) return;
        const identified = slot.identify(cardId);
        if (!identified && cardId > 0) {
          const matched = getSlotsByKey(cardId).find((entry) => entry !== slot);
          if (matched) {
            slot.swap(matched)?.identify(cardId);
          }
        }
      });
    } else if (taken.filter((slot) => slot.key > 0).length === this.count) {
      taken.forEach((slot, index) => {
        ids[index] = slot.id as number;
      });
    }
    drawZone(this.zoneID);
    return taken;
  }

  /** 这些牌进入这一区。已经在这一区里的同一张牌不再放第二次。 */
  add(cards: CardSlot | CardSlot[]): CardSlot | CardSlot[] {
    if (!isCardGraphReady()) return cards;
    const moved = (moveSlots(cards, this.zoneID) as CardSlot[]).slice();
    const incoming = moved.filter((slot, index) => moved.indexOf(slot) === index);
    for (const slot of incoming) {
      const cardId = Number(slot.id);
      if (!(cardId > 0)) continue;
      for (let index = this.cards.length - 1; index >= 0; index -= 1) {
        const existing = this.cards[index];
        if (existing !== slot && Number(existing.id) === cardId) this.cards.splice(index, 1);
      }
    }
    const fresh = incoming.filter((slot) => !this.cards.includes(slot));
    if (Number(this.zone) === 1) {
      // 构造牌堆区时顶底已经对调：内部位置 0 是牌堆顶，0xff00 是牌堆底。
      const edge = this.pos === DRAW_PILE_BOTTOM ? 'top' : this.pos === DRAW_PILE_TOP ? 'bottom' : '';
      if (edge) fresh.forEach((slot) => { slot.pileEdge = edge; });
    }
    if (this.pos === POSITION_UNSPECIFIED || this.pos === DRAW_PILE_TOP) {
      this.cards.splice(this.cards.length, 0, ...fresh);
    } else {
      this.cards.splice(this.pos, 0, ...fresh.reverse());
    }
    drawZone(this.zoneID);
    return cards;
  }

  /** 用这些牌替换整个区域。 */
  set(cards: CardSlot | CardSlot[]): void {
    if (!isCardGraphReady()) return;
    zoneStore.set(this.zoneID, moveSlots(cards, this.zoneID) as CardSlot[]);
    drawZone(this.zoneID);
  }
}

/**
 * 从牌堆顶摸牌。先拿顶上的明牌和未知牌。
 * 放在牌堆底的明牌留在原处，不够的张数用新的未知牌补上。
 */
/** 从牌堆底摸。遇到单独放在顶上的明牌就停下，不够的张数用未知牌补。 */
function takeKnownBottom(cards: CardSlot[], count: number, zoneId: string): CardSlot[] {
  const taken: CardSlot[] = [];
  let index = cards.length - 1;
  while (taken.length < count && index >= 0) {
    const slot = cards[index];
    if (slot?.pileEdge === 'top' && slot.key > 0) break;
    const [removed] = cards.splice(index, 1);
    if (removed) taken.push(removed);
    index -= 1;
  }
  while (taken.length < count) taken.push(new CardSlot(0, 0, zoneId));
  return taken.reverse();
}

function takeKnownTop(cards: CardSlot[], count: number, zoneId: string): CardSlot[] {
  const taken: CardSlot[] = [];
  let index = 0;
  while (taken.length < count && index < cards.length) {
    const slot = cards[index];
    if (slot?.pileEdge === 'bottom' && slot.key > 0) break;
    const [removed] = cards.splice(index, 1);
    if (removed) taken.push(removed);
  }
  while (taken.length < count) taken.push(new CardSlot(0, 0, zoneId));
  return taken;
}

/** 把槽位搬到目标区域，并同步明牌标签的生命周期。 */
export function moveSlots(
  cards: CardSlot | CardSlot[],
  zoneId: string
): CardSlot | CardSlot[] {
  const list = Array.isArray(cards) ? cards : [cards];
  list.forEach((slot) => {
    if (String(slot?.zone || '').startsWith('5-') && String(slot.zone) !== String(zoneId)) {
      retainPersistentMingpaiCardTags(Number(slot.id));
    }
    Object.assign(slot, { zone: zoneId, turn: clock.turn, round: clock.round, phase: clock.phase });
  });
  const keys = [...new Set(list.map((slot) => slot.key))];
  if (keys.some((key) => key <= 0)) {
    drawZone(UNKNOWN_ZONE);
  } else {
    keys.filter((key) => key > 0 && cardCounter.query.has(key)).forEach((key) => {
      cardCounter.plot(key, zoneId === DEFAULT_ZONE ? 3 : zoneId === DISCARD_ZONE_ID ? 2 : 1);
    });
  }
  return cards;
}

/** 记下这一格的标签；粘性标签会沉淀下来，离开手牌也不丢。 */
export function rememberMingpaiCardTags(cardId: number, tags: readonly string[] = []): string[] {
  const id = Number(cardId);
  if (!(id > 0)) return [];
  const incoming = normalizeTags(tags);
  const hasSource = incoming.some(isSourceHandLabel);
  const persistent = normalizeTags([
    ...(mingpaiPersistentCardTags.get(id) ?? []).filter((tag) => !hasSource || !isSourceHandLabel(tag)),
    ...incoming.filter((tag) => isStickyMingpaiTag(tag) || isSourceHandLabel(tag))
  ]);
  if (persistent.length) mingpaiPersistentCardTags.set(id, persistent);
  const all = normalizeTags([...incoming, ...persistent]);
  mingpaiCardTags.set(id, all);
  return all;
}

/** 某个标签是不是会一直跟着牌的粘性标签。 */
export function isStickyMingpaiTag(tag: string): boolean {
  return STICKY_TAGS.has(String(tag ?? '').trim());
}

/** 在现有标签上追加，粘性标签照旧沉淀。 */
export function mergeMingpaiCardTags(cardId: number, tags: readonly string[]): string[] {
  const id = Number(cardId);
  if (!(id > 0)) return [];
  const incoming = normalizeTags([...getMingpaiCardTags(id), ...tags]);
  return rememberMingpaiCardTags(id, incoming);
}

/** 主动去掉一个标签，当前标签和持久标签一起清。 */
export function forgetMingpaiCardTag(cardId: number, tag: string): string[] {
  const id = Number(cardId);
  const normalized = String(tag ?? '').trim();
  if (!(id > 0) || !normalized) return getPersistentMingpaiCardTags(id);
  const persistent = (mingpaiPersistentCardTags.get(id) ?? []).filter((entry) => entry !== normalized);
  if (persistent.length) mingpaiPersistentCardTags.set(id, persistent);
  else mingpaiPersistentCardTags.delete(id);
  const current = (mingpaiCardTags.get(id) ?? []).filter((entry) => entry !== normalized);
  if (current.length) mingpaiCardTags.set(id, current);
  else mingpaiCardTags.delete(id);
  return [...persistent];
}

export function getPersistentMingpaiCardTags(cardId: number): string[] {
  return [...(mingpaiPersistentCardTags.get(Number(cardId)) ?? [])];
}

/** 持久标签里还带着这个字的牌。清标记时不能只看当前牌位，没进牌位图的牌也要清。 */
export function listCardIdsWithPersistentTag(tag: string): number[] {
  const normalized = String(tag ?? '').trim();
  if (!normalized) return [];
  const cardIds: number[] = [];
  mingpaiPersistentCardTags.forEach((tags, cardId) => {
    if (tags.includes(normalized)) cardIds.push(cardId);
  });
  return cardIds;
}

export function getMingpaiCardTags(cardId: number): string[] {
  return (mingpaiCardTags.get(Number(cardId)) ?? []).slice();
}

/** 记下这些牌原本属于哪个座位，并打上「炁」。 */
export function rememberMingpaiQiCards(seatId: number, cardIds: number | readonly number[] = []): number[] {
  const seat = Number(seatId);
  if (!Number.isInteger(seat) || seat < 0) return [];
  const ids = [...new Set((Array.isArray(cardIds) ? cardIds : [cardIds])
    .map(Number)
    .filter((cardId) => cardId > 0))];
  return ids.map((cardId) => {
    mingpaiQiOwnerByCard.set(cardId, seat);
    rememberMingpaiCardTags(cardId, [QI_TAG]);
    return cardId;
  });
}

export function getMingpaiQiOwner(cardId: number): number | null {
  const seat = mingpaiQiOwnerByCard.get(Number(cardId));
  return Number.isInteger(seat) ? seat as number : null;
}

/** 丢掉非持久标签，只留下会跟着牌走的那些。 */
export function retainPersistentMingpaiCardTags(cardId: number): string[] {
  const id = Number(cardId);
  if (!(id > 0)) return [];
  const persistent = (mingpaiPersistentCardTags.get(id) ?? []).filter((tag) => !isSourceHandLabel(tag));
  if (persistent.length) mingpaiPersistentCardTags.set(id, persistent);
  else mingpaiPersistentCardTags.delete(id);
  if (persistent.length) mingpaiCardTags.set(id, persistent);
  else mingpaiCardTags.delete(id);
  return persistent;
}

/** 座位公开手牌集合变化时，离场的牌回收普通标签。 */
export function syncOfficialMingpaiHandCards(seatId: number, cardIds: readonly number[] = []): void {
  const seat = Number(seatId);
  if (!Number.isFinite(seat)) return;
  const next = new Set(cardIds.map(Number).filter((cardId) => cardId > 0));
  const previous = officialHandCardsBySeat.get(seat) ?? new Set<number>();
  previous.forEach((cardId) => {
    if (!next.has(cardId)) retainPersistentMingpaiCardTags(cardId);
  });
  officialHandCardsBySeat.set(seat, next);
}

export function getOfficialMingpaiHandCards(seatId: number): number[] {
  return [...(officialHandCardsBySeat.get(Number(seatId)) ?? [])];
}

/** 重置整张牌位图，返回默认区域里为这些牌号建立的槽位。 */
export function initCardGraph(cardIds: readonly number[], defaultZone: string = DEFAULT_ZONE): CardSlot[] {
  slotCounter = 0;
  slotsByKey = new Map();
  mingpaiCardTags.clear();
  mingpaiPersistentCardTags.clear();
  officialHandCardsBySeat.clear();
  mingpaiQiOwnerByCard.clear();
  reshufflePoolKeys.clear();
  zoneStore = new Map([[UNKNOWN_ZONE, new Set<CardSlot>()]]);
  const created = cardIds.map((cardId) => new CardSlot(0, cardId, defaultZone));
  zoneStore.set(defaultZone, created);
  return created;
}

export function getReshufflePoolKeys(): number[] {
  return [...reshufflePoolKeys];
}

/** 这一组是不是已经被洗回牌堆、身份不可知。 */
export function hasReshufflePoolKey(key: number): boolean {
  return reshufflePoolKeys.has(key);
}

/** 清空明牌标签、炁归属、公开手牌集合与洗牌池登记，位置不受影响。 */
export function resetMingpaiTags(): void {
  mingpaiCardTags.clear();
  mingpaiPersistentCardTags.clear();
  officialHandCardsBySeat.clear();
  mingpaiQiOwnerByCard.clear();
  reshufflePoolKeys.clear();
}

export class CardFace {
  id: number;
  name: string;
  color: number;
  number: number;
  type: number;
  key = -1;

  constructor(id: number, info: CardFaceInfo) {
    this.id = id;
    this.name = info.name;
    this.color = info.color;
    this.number = info.number;
    this.type = info.type;
  }
}

/**
 * 牌名 / 花色 / 点数 / 类型统计与筛选状态。
 * 只维护数据，界面靠 onCountersChanged 回调重画。
 */
export const cardCounter = {
  name: {} as Record<string, Set<number>>,
  color: Array.from({ length: 7 }, () => new Set<number>()),
  number: Array.from({ length: 14 }, () => new Set<number>()),
  type: Array.from({ length: 4 }, () => new Set<number>()),
  query: new Set<number>(),
  select: {
    name: new Set<string>(),
    color: new Set<number>(),
    number: new Set<number>()
  },
  cards: [] as CardFace[],
  /** 卡号 → 牌面，由外部注入。 */
  faceOf: null as ((cardId: number) => CardFaceInfo | undefined) | null,

  /** 某张牌换了归属，刷新统计。 */
  counter(cardId: number | undefined, key: number): void {
    const face = cardId ? this.faceOf?.(cardId) : undefined;
    if (cardId !== undefined && (!cardId || !face || this.name[face.name] === undefined)) return;
    void key;
    hooks.onCountersChanged?.();
  },

  /** 牌堆 / 弃牌堆 / 销毁态切换时的挂点。 */
  plot(key: number, kind: number): void {
    void key;
    void kind;
    hooks.onCountersChanged?.();
  },

  add(cardId: number, key: number | null = null): void {
    const info = this.faceOf?.(cardId);
    if (!info) return;
    if (!(info.name in this.name)) this.name[info.name] = new Set();
    this.name[info.name].add(cardId);
    this.color[info.color]?.add(cardId);
    this.number[info.number]?.add(cardId);
    this.type[info.type]?.add(cardId);
    if (info.color === 3 && info.number >= 2 && info.number <= 9) this.number[0].add(cardId);
    if (/^(冰|火|雷)?杀$/.test(info.name)) this.color[Math.ceil(info.color / 2) + 4]?.add(cardId);
    this.cards[cardId] = new CardFace(cardId, info);
    if (key !== null) this.counter(cardId, key);
  },

  init(cardIds: readonly number[]): void {
    this.name = {};
    this.color = Array.from({ length: 7 }, () => new Set<number>());
    this.number = Array.from({ length: 14 }, () => new Set<number>());
    this.type = Array.from({ length: 4 }, () => new Set<number>());
    this.query = new Set<number>();
    this.select = { name: new Set(), color: new Set(), number: new Set() };
    this.cards = [];
    cardIds.forEach((cardId) => this.add(cardId));
  }
};

function normalizeTags(tags: readonly unknown[]): string[] {
  return [...new Set(tags.map((tag) => String(tag ?? '').trim()).filter(Boolean))];
}
