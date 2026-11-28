/**
 * 山河地图几何计算：坐标变换、命中测试与路径辅助。
 */

import {
  ROGUE_MAP_STYLE,
  type RogueCityGeometry,
  type RogueCityMeta,
  type RogueRect
} from './shanhetu-map-types.ts';

type UnknownRecord = Record<string, unknown>;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

function isVisible(node: unknown): boolean {
  const record = asRecord(node);
  if (!record || record.destroyed) return false;
  if (typeof record._visible === 'boolean') return record._visible;
  return record.visible !== false;
}

/** 该城是否还要画突袭关卡。 */
export function needsRaidGate(difficulty: number): boolean {
  return (Number(difficulty) || 0) <= ROGUE_MAP_STYLE.difficultyRaidGate;
}

/** 读取突袭关卡条目。 */
export function readRaidItem(cityView: UnknownRecord | null): UnknownRecord | null {
  const item = asRecord(cityView?.raidItem);
  return item && isVisible(item) ? item : null;
}

/** 读取突袭障碍。 */
export function readRaidObstacle(cityView: UnknownRecord | null): RogueRect | null {
  const item = readRaidItem(cityView);
  if (!item || item.open !== true) return null;
  const bounds = projectNodeBounds(cityView, item, true);
  if (!bounds) return null;
  return {
    id: 'raid',
    x: bounds.left,
    y: bounds.top,
    w: bounds.right - bounds.left,
    h: bounds.bottom - bounds.top,
    centerX: (bounds.left + bounds.right) / 2,
    centerY: (bounds.top + bounds.bottom) / 2
  };
}

export interface RogueMapViewport {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * 面板必须落在 topProcesserView 下方、bottomView 上方，
 * 避免盖住顶栏面具/进度条和底栏。
 */
export function readMapViewport(
  cityView: UnknownRecord | null,
  scene: UnknownRecord | null
): RogueMapViewport | null {
  if (!cityView) return null;
  const viewX = Number(cityView.x) || 0;
  const viewY = Number(cityView.y) || 0;
  const viewW = Number(cityView.width) || 0;
  const viewH = Number(cityView.height) || 0;
  let left = viewW > 0 ? -viewX : -Infinity;
  let top = viewH > 0 ? -viewY : -Infinity;
  let right = viewW > 0 ? viewW - viewX : Infinity;
  let bottom = viewH > 0 ? viewH - viewY : Infinity;

  const pad = ROGUE_MAP_STYLE.viewportPad;
  const topHud = projectNodeBounds(cityView, asRecord(scene?.topProcesserView), true)
    ?? projectNodeBounds(cityView, asRecord(scene?.topView), true);
  if (topHud) top = Math.max(top, topHud.bottom + pad);

  const bottomView = asRecord(scene?.bottomView) ?? asRecord(scene?.bottomBar);
  if (bottomView) {
  // 手牌多在 bottomView 子节点里，按 cardItemList 投到 cityView 比只量底栏外框更准。
    const handBounds = readHandBoundsInCityView(cityView, scene);
    if (handBounds) bottom = Math.min(bottom, handBounds.top - pad);
  }

  // 高面板可以向上溢出，但不能因上下栏挤满视口而取消手牌底边约束。
  if (!(right > left)) return null;
  if (Number.isFinite(bottom) && bottom <= top + pad * 2) top = bottom - pad * 2 - 1;
  return { left: left + pad, top: top + pad, right: right - pad, bottom: bottom - pad };
}

/** 合并手牌容器内可见子节点的投影，容器本身可能没有宽高。 */
export function readHandBoundsInCityView(view: UnknownRecord | null, scene: UnknownRecord | null): Bounds | null {
 const bottom=asRecord(scene?.bottomView) ?? asRecord(scene?.bottomBar);
 if (!view || !bottom || !isVisible(bottom)) return null;
 let merged: Bounds | null=null;
 for (const node of collectBottomHandNodes(bottom)) {
  const bounds=projectNodeTreeBounds(view,node,16);
  if (bounds) merged=merged ? unionBounds(merged,bounds) : bounds;
 }
 return merged ?? projectNodeTreeBounds(view,bottom,16);
}
interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function unionBounds(first: Bounds, second: Bounds): Bounds {
  return {
    left: Math.min(first.left, second.left),
    top: Math.min(first.top, second.top),
    right: Math.max(first.right, second.right),
    bottom: Math.max(first.bottom, second.bottom)
  };
}

/** bottomView 内实际放手牌、战法技能的节点，用于推算手牌区上沿。 */
function collectBottomHandNodes(bottomView: UnknownRecord): UnknownRecord[] {
  const nodes: UnknownRecord[] = [];
  const cardList = bottomView.cardItemList;
  if (Array.isArray(cardList)) {
    for (const entry of cardList) {
      const item = asRecord(entry);
      if (item) nodes.push(item);
    }
  }
  for (const key of ['skillItemSpr', 'zhanfaItemSpr']) {
    const item = asRecord(bottomView[key]);
    if (item) nodes.push(item);
  }
  return nodes;
}

function projectNodeTreeBounds(
  parent: UnknownRecord,
  node: UnknownRecord,
  depth: number
): Bounds | null {
  if (!isVisible(node)) return null;
  let merged: Bounds | null = projectNodeBounds(parent, node);
  if (depth <= 0 || typeof node.numChildren !== 'number') return merged;
  const count = Number(node.numChildren);
  for (let index = 0; index < count; index += 1) {
    const getter = node.getChildAt;
    if (typeof getter !== 'function') break;
    const child = asRecord((getter as Function).call(node, index));
    if (!child || !isVisible(child)) continue;
    const bounds = projectNodeTreeBounds(parent, child, depth - 1);
    if (bounds) merged = merged ? unionBounds(merged, bounds) : bounds;
  }
  return merged;
}

function projectNodeBounds(
  parent: UnknownRecord | null,
  node: UnknownRecord | null,
  forceSelf = false
): Bounds | null {
  if (!parent || !node || !isVisible(node)) return null;
  const width = Number(node.width) || 0;
  const height = Number(node.height) || 0;
  const childCount = Number(node.numChildren) || 0;
  if ((!childCount || forceSelf) && width > 0 && height > 0
    && typeof parent.globalToLocal === 'function'
    && typeof node.localToGlobal === 'function') {
    try {
      const Point = asRecord((globalThis as UnknownRecord).Laya)?.Point as
        | (new (x: number, y: number) => { x: number; y: number })
        | undefined;
      const p0 = Point ? new Point(0, 0) : { x: 0, y: 0 };
      const p1 = Point ? new Point(width, height) : { x: width, y: height };
      const g0 = (node.localToGlobal as Function).call(node, p0);
      const g1 = (node.localToGlobal as Function).call(node, p1);
      const l0 = (parent.globalToLocal as Function).call(parent, g0);
      const l1 = (parent.globalToLocal as Function).call(parent, g1);
      const xs = [Number(l0?.x), Number(l1?.x)].filter(Number.isFinite);
      const ys = [Number(l0?.y), Number(l1?.y)].filter(Number.isFinite);
      if (xs.length === 2 && ys.length === 2) {
        return {
          left: Math.min(...xs),
          top: Math.min(...ys),
          right: Math.max(...xs),
          bottom: Math.max(...ys)
        };
      }
    } catch {
      // 计算失败时改走下面的回退
    }
  }
  return null;
}

function cityCenter(
  item: UnknownRecord,
  scaleX: number,
  scaleY: number
): { x: number; y: number } {
  const x = Number(item.x) || 0;
  const y = Number(item.y) || 0;
  let cx: number | undefined;
  let cy: number | undefined;
  try {
    cx = Number(item.PosXCenter);
    cy = Number(item.PosYDown);
  } catch {
    // 忽略异常
  }
  return {
    x: Number.isFinite(cx!) ? cx! : x + (ROGUE_MAP_STYLE.cityDefaultWidth * scaleX) / 2,
    y: Number.isFinite(cy!) ? (y + cy!) / 2 : y + (ROGUE_MAP_STYLE.cityDefaultHeight * scaleY) / 2
  };
}

function mergeVisualArea(
  item: UnknownRecord,
  fallback: RogueRect,
  scaleX: number,
  scaleY: number
): RogueRect {
  const boxes: RogueRect[] = [];
  const baseX = Number(item.x) || 0;
  const baseY = Number(item.y) || 0;
  const cityImg = asRecord(item.cityImg);
  const imgW = Number(cityImg?.width) || 0;
  const imgH = Number(cityImg?.height) || 0;
  if (imgW > 0 && imgH > 0) {
    const ox = Number(cityImg?.x) || 0;
    const oy = Number(cityImg?.y) || 0;
    boxes.push({
      x: baseX + ox * scaleX,
      y: baseY + oy * scaleY,
      w: imgW * scaleX,
      h: imgH * scaleY,
      centerX: 0,
      centerY: 0
    });
  }
  const nameImg = asRecord(item.citynameImg);
  if (isVisible(nameImg)) {
    const nw = Number(nameImg?.width) || 0;
    const nh = Number(nameImg?.height) || 0;
    if (nw > 0 && nh > 0) {
      const ox = Number(nameImg?.x) || 0;
      const oy = Number(nameImg?.y) || 0;
      boxes.push({
        x: baseX + ox * scaleX,
        y: baseY + oy * scaleY,
        w: nw * scaleX,
        h: nh * scaleY,
        centerX: 0,
        centerY: 0
      });
    }
  }
  if (!boxes.length) return fallback;
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.w));
  const bottom = Math.max(...boxes.map((box) => box.y + box.h));
  return {
    x: left,
    y: top,
    w: right - left,
    h: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2
  };
}

/** 优先 GetCityItemById，否则用 Rcity 表坐标。 */
export function resolveCityGeometry(
  cityView: UnknownRecord | null,
  cityId: string | number,
  meta: RogueCityMeta
): RogueCityGeometry {
  const getter = cityView?.GetCityItemById;
  const item = typeof getter === 'function'
    ? asRecord((getter as Function).call(cityView, cityId))
    : null;
  if (item) {
    const scaleX = Number(item.scaleX) || Number(cityView?.directionX) || 1;
    const scaleY = Number(item.scaleY) || Number(cityView?.directionY) || scaleX;
    const center = cityCenter(item, scaleX, scaleY);
    const box: RogueRect = {
      x: Number(item.x) || 0,
      y: Number(item.y) || 0,
      w: ROGUE_MAP_STYLE.cityDefaultWidth * scaleX,
      h: ROGUE_MAP_STYLE.cityDefaultHeight * scaleY,
      centerX: center.x,
      centerY: center.y
    };
    return { ...box, visualArea: mergeVisualArea(item, box, scaleX, scaleY) };
  }
  const dirX = Number(cityView?.directionX) || 1;
  const dirY = Number(cityView?.directionY) || dirX;
  const box: RogueRect = {
    x: meta.x * dirX,
    y: meta.y * dirY,
    w: ROGUE_MAP_STYLE.cityDefaultWidth * dirX,
    h: ROGUE_MAP_STYLE.cityDefaultHeight * dirY,
    centerX: meta.x * dirX + (ROGUE_MAP_STYLE.cityDefaultWidth * dirX) / 2,
    centerY: meta.y * dirY + (ROGUE_MAP_STYLE.cityDefaultHeight * dirY) / 2
  };
  return { ...box, visualArea: box };
}

/**
 * 城池图是否已经能用来算布局。
 * 继续征程里贴图可能缩放、延迟设宽高或短暂不可见；有条目坐标或纹理即可画，避免无限 pending-images。
 */
// 继续征程的缩放贴图不一定等于纹理原尺寸，先按条目坐标画，再按实际几何重排。
export function cityImageReady(cityView: UnknownRecord | null, cityId: string | number): boolean {
  const getter = cityView?.GetCityItemById;
  if (typeof getter !== 'function') return true;
  const item = asRecord((getter as Function).call(cityView, cityId));
  if (!item) return true;
  const posX = Number(item.x);
  const posY = Number(item.y);
  if (Number.isFinite(posX) && Number.isFinite(posY)) return true;

  const cityImg = asRecord(item?.cityImg);
  if (!cityImg) return true;
  const width = Number(cityImg.width) || 0;
  const height = Number(cityImg.height) || 0;
  if (width > 0 && height > 0) return true;

  const textureWidth = Number(cityImg.textureWidth) || 0;
  const textureHeight = Number(cityImg.textureHeight) || 0;
  if (textureWidth > 0 && textureHeight > 0) return true;

  const texture = asRecord(cityImg.texture) ?? asRecord(cityImg._texture);
  if (texture) {
    const bitmapWidth = Number(texture.width) || Number(texture.sourceWidth) || 0;
    const bitmapHeight = Number(texture.height) || Number(texture.sourceHeight) || 0;
    if (bitmapWidth > 0 && bitmapHeight > 0) return true;
  }

  const source = asRecord(cityImg.source) ?? asRecord(cityImg._source);
  if (source) {
    const sourceWidth = Number(source.width) || Number(asRecord(source.bitmap)?.width) || 0;
    const sourceHeight = Number(source.height) || Number(asRecord(source.bitmap)?.height) || 0;
    if (sourceWidth > 0 && sourceHeight > 0) return true;
  }

  return false;
}

/** 给城池列表做指纹，没变化就不重画。 */
export function fingerprintCities(
  cityView: UnknownRecord | null,
  cities: readonly { id: string | number; event?: string | number }[]
): string {
  const dirX = Number(cityView?.directionX) || 1;
  const dirY = Number(cityView?.directionY) || dirX;
  // event + HasEvent：打完关后同城事件/可点状态变化时必须重绘或清空。
  const ids = cities.map((city) => {
    const eventMark = city.event ?? '';
    const hasEvent = readCityHasEvent(cityView, city.id);
    return `${city.id}:${eventMark}:${hasEvent}`;
  }).join(',');
  return `${dirX}|${dirY}|${ids}`;
}

/** `true` / `false` / `unknown`（节点未就绪或字段缺失时不当作已领取）。 */
export function readCityHasEvent(
  cityView: UnknownRecord | null,
  cityId: string | number
): 'true' | 'false' | 'unknown' {
  const getter = cityView?.GetCityItemById;
  if (typeof getter !== 'function') return 'unknown';
  const item = asRecord((getter as Function).call(cityView, cityId));
  if (!item) return 'unknown';
  // 游戏侧偶发用 0/1，不能只认严格布尔。
  if (item.HasEvent === true || item.HasEvent === 1) return 'true';
  if (item.HasEvent === false || item.HasEvent === 0) return 'false';
  return 'unknown';
}

/** 虚线引导。 */
export function dashSegments(
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  dash = ROGUE_MAP_STYLE.dashLength,
  gap = ROGUE_MAP_STYLE.dashGap
): Array<{ fromX: number; fromY: number; toX: number; toY: number }> {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const distance = Math.hypot(dx, dy);
  if (!distance) return [];
  const ux = dx / distance;
  const uy = dy / distance;
  const segments: Array<{ fromX: number; fromY: number; toX: number; toY: number }> = [];
  for (let offset = 0; offset < distance; offset += dash + gap) {
    const end = Math.min(offset + dash, distance);
    segments.push({
      fromX: fromX + ux * offset,
      fromY: fromY + uy * offset,
      toX: fromX + ux * end,
      toY: fromY + uy * end
    });
  }
  if (segments.length) {
    segments[segments.length - 1].toX = toX;
    segments[segments.length - 1].toY = toY;
  }
  return segments;
}
