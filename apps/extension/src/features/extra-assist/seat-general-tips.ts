/**
 * 座位武将 tip：收集目标座位并应用/清理浮层提示。
 */

type UnknownRecord = Record<string, unknown>;

export interface SeatTipTarget {
  seat?: unknown;
  seatAvatar?: UnknownRecord | null;
}

export interface SeatTipLayaWindow {
  Laya?: {
    Text?: new () => SeatTipTextNode;
    Sprite?: new () => SeatTipTextNode;
  };
}

export interface SeatTipTextNode {
  name?: string;
  fontSize?: number;
  color?: string;
  stroke?: number;
  strokeColor?: string;
  align?: string;
  bold?: boolean;
  bgColor?: string;
  leading?: number;
  wordWrap?: boolean;
  mouseEnabled?: boolean;
  zOrder?: number;
  width?: number;
  height?: number;
  text?: string;
  visible?: boolean;
  pos?: (x: number, y: number) => void;
  addChild?: (child: SeatTipTextNode) => void;
  destroy?: (destroyChildren?: boolean) => void;
  removeSelf?: () => void;
  __xcTipLines?: SeatTipTextNode[];
}

const TIP_PROPERTY_PREFIX = '__xcGeneralTip_';

/**
 * 在武将头像右下角挂 Laya.Text 提示。
 * enabled=false 或文案为空时隐藏；节点复用，避免每帧重建。
 */
export interface SeatTipStyle {
  fontSize: number;
  color: string;
  stroke: number;
  strokeColor: string;
  align: string;
  bold?: boolean;
  bgColor?: string;
  /** 相对头像左上角；缺省贴右下。 */
  place?: (avatar: UnknownRecord) => { x: number; y: number; width: number; height: number };
}

/** 在武将牌上挂或更新一条文字提示。 */
export function applySeatGeneralTip(options: {
  key: string;
  targets: readonly SeatTipTarget[];
  enabled: boolean;
  getText: (target: SeatTipTarget) => string;
  globalObject?: SeatTipLayaWindow;
  style?: SeatTipStyle;
}): void {
  const { key, targets, enabled, getText, globalObject = window as SeatTipLayaWindow, style } = options;
  if (!key) return;
  for (const target of targets) {
    const avatar = asRecord(target.seatAvatar);
    if (!avatar) continue;
    const text = enabled ? String(getText(target) || '') : '';
    const property = `${TIP_PROPERTY_PREFIX}${key}`;
    let node = asTipNode(avatar[property]);
    if (!node && !text) continue;
    if (!node) {
      const Sprite = globalObject.Laya?.Sprite;
      const Text = globalObject.Laya?.Text;
      if (!Sprite || !Text) continue;
      node = new Sprite();
      node.name = `xcGeneralCardTip-${key}`;
      node.mouseEnabled = false;
      node.zOrder = 999;
      node.__xcTipLines = [];
      avatar[property] = node;
      const addChild = avatar.addChild;
      if (typeof addChild === 'function') addChild.call(avatar, node);
    }
    const box = applyTipStyle(node, avatar, style);
    fillTipLines(node, text, style, box.width, globalObject);
    node.visible = Boolean(text);
  }
}

/** 清掉指定 key 的座位提示（关开关 / 离场）。 */
export function clearSeatGeneralTips(
  targets: readonly SeatTipTarget[],
  key: string
): void {
  const property = `${TIP_PROPERTY_PREFIX}${key}`;
  for (const target of targets) {
    const avatar = asRecord(target.seatAvatar);
    if (!avatar) continue;
    const node = asTipNode(avatar[property]);
    if (!node) continue;
    try {
      node.removeSelf?.();
      node.destroy?.(true);
    } catch {
      // 忽略异常
    }
    delete avatar[property];
  }
}

/** 从座位界面收集可以挂提示的武将牌。 */
export function collectSeatTipTargets(seatUIs: unknown): SeatTipTarget[] {
  if (!Array.isArray(seatUIs)) return [];
  return seatUIs.map((raw) => {
    const seatUI = asRecord(raw);
    return {
      seat: seatUI?.seat ?? seatUI,
      seatAvatar: asRecord(seatUI?.seatAvatar) ?? null
    };
  });
}

function applyTipStyle(
  node: SeatTipTextNode,
  avatar: UnknownRecord,
  style: SeatTipStyle | undefined
): { x: number; y: number; width: number; height: number } {
  const box = style?.place?.(avatar) ?? defaultTipBox(avatar);
  node.width = box.width;
  node.height = box.height;
  node.pos?.(box.x, box.y);
  return box;
}

/** 网页端文字组件会丢掉换行符，所以每条增益单独一行。 */
function fillTipLines(
  container: SeatTipTextNode,
  text: string,
  style: SeatTipStyle | undefined,
  width: number,
  globalObject: SeatTipLayaWindow
): void {
  const Text = globalObject.Laya?.Text;
  const lines = text ? text.split('\n') : [];
  if (container.text) container.text = '';
  const lineNodes = container.__xcTipLines ?? (container.__xcTipLines = []);
  const fontSize = style?.fontSize ?? 12;
  const lineHeight = fontSize + 2;
  if (Text) {
    while (lineNodes.length < lines.length) {
      const line = new Text();
      line.mouseEnabled = false;
      line.wordWrap = false;
      container.addChild?.(line);
      lineNodes.push(line);
    }
  }
  for (let index = 0; index < lineNodes.length; index += 1) {
    const line = lineNodes[index];
    if (!line) continue;
    if (index >= lines.length) {
      line.visible = false;
      continue;
    }
    line.visible = true;
    line.fontSize = fontSize;
    line.color = style?.color ?? '#FFFFFF';
    line.stroke = style?.stroke ?? 2;
    line.strokeColor = style?.strokeColor ?? '#000000';
    line.align = style?.align ?? 'right';
    line.bold = style?.bold ?? false;
    line.bgColor = style?.bgColor;
    line.wordWrap = false;
    line.width = width;
    line.height = lineHeight;
    line.pos?.(0, index * lineHeight);
    const lineText = lines[index] ?? '';
    if (line.text !== lineText) line.text = lineText;
  }
}

function defaultTipBox(avatar: UnknownRecord): { x: number; y: number; width: number; height: number } {
  const avatarWidth = Number(avatar.width) || 0;
  return {
    x: Math.max(0, avatarWidth - 70 - 15),
    y: 40,
    width: 70,
    height: 90
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function asTipNode(value: unknown): SeatTipTextNode | null {
  return value && typeof value === 'object' ? value as SeatTipTextNode : null;
}
