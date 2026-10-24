/**
 * 八人自选身份的座位顺序对应身份：主公、忠臣、忠臣、内奸，其余为反贼。
 * 身份编号与牌局内 Figure 一致。
 */
const FIGURE_BY_SEAT_ORDER = [1, 2, 2, 4, 3, 3, 3, 3] as const;

type UnknownRecord = Record<string, unknown>;

/** 房间设置里与自选身份相关的文案。 */
export const CHOOSE_IDENTITY_MODE_TEXT = /自选身份|身份自选|自选反贼|反贼自选|自选主忠|主忠自选/;

const CHOOSE_FIGURE_KEY = /(?:choose|select).*(figure|identity|rebel|lord|loyal|zhong|fan|zhu|role)|(?:figure|identity|rebel|lord|loyal|zhong|fan|zhu|role).*(?:choose|select)/i;

export function isIdentityDrillContext(input: { modeText: string; modeType?: number }): boolean {
  return input.modeText.includes('演武')
    || input.modeType === 74
    || input.modeType === 84;
}

/** 游戏在房间或设置上直接标记了自选身份。 */
export function isExplicitChooseFigure(setting: UnknownRecord | null): boolean {
  if (!setting) return false;
  for (const key of ['IsChooseFigure', 'isChooseFigure']) {
    const raw = setting[key];
    if (raw === true || raw === 1 || raw === '1') return true;
  }
  return false;
}

function settingDeclaresChooseIdentity(setting: UnknownRecord): boolean {
  for (const value of Object.values(setting)) {
    if (typeof value === 'string' && CHOOSE_IDENTITY_MODE_TEXT.test(value)) return true;
  }
  return Object.entries(setting).some(([key, value]) => {
    if (!CHOOSE_FIGURE_KEY.test(key)) return false;
    return typeof value === 'string' && CHOOSE_IDENTITY_MODE_TEXT.test(value.trim());
  });
}

/** 当前房间设置是否属于自选身份类，不能单凭 SelType 大于 0 认定。 */
export function isChooseFigureSetting(setting: UnknownRecord | null): boolean {
  if (!setting) return false;
  if (isExplicitChooseFigure(setting)) return true;
  if (!settingDeclaresChooseIdentity(setting)) return false;
  for (const key of ['SelType', 'selType', 'SelectType', 'selectType', 'SelfSelectType', 'selfSelectType']) {
    const raw = setting[key];
    const value = typeof raw === 'string' ? Number(raw) : raw;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return true;
  }
  return true;
}

export interface ChooseFigureModeInput {
  modeText: string;
  modeType?: number;
  chooseFigure: boolean;
  chooseFigureExplicit?: boolean;
}

/**
 * 只有自选身份局才按座位顺序写身份。普通八人军争即使 SelType 误读也不能开。
 */
export function shouldRevealIdentityFigures(input: ChooseFigureModeInput): boolean {
  if (!input.chooseFigure) return false;
  if (input.chooseFigureExplicit) return true;
  if (CHOOSE_IDENTITY_MODE_TEXT.test(input.modeText)) return true;
  return isIdentityDrillContext(input);
}

/** 按房间座位序号取身份。越界时返回 0，调用方应跳过。 */
export function figureForChooseIdentityOrder(order: number): number {
  return FIGURE_BY_SEAT_ORDER[order] ?? 0;
}

/**
 * 用房间座位表里的账号顺序决定该玩家的身份。
 * 表长不是 8，或账号对不上时返回 0，避免把别的模式写成身份。
 */
export function figureByClientOrder(clientIds: readonly unknown[], clientId: unknown): number {
  if (clientIds.length !== FIGURE_BY_SEAT_ORDER.length) return 0;
  const key = normalizeClientId(clientId);
  if (!key) return 0;
  const order = clientIds.findIndex((id) => normalizeClientId(id) === key);
  return figureForChooseIdentityOrder(order);
}

/** 账号编号统一成字符串再比较，避免数字和字符串对不上。 */
function normalizeClientId(value: unknown): string {
  const id = Number(value);
  return Number.isFinite(id) && id > 0 ? String(id) : '';
}

/** 身份编号只有 1 主公 / 2 忠臣 / 3 反贼 / 4 内奸四种，别的值都不当身份用。 */
export function isIdentityFigure(value: unknown): boolean {
  const figure = Number(value);
  return Number.isInteger(figure) && figure >= 1 && figure <= 4;
}

/**
 * 候选身份和游戏已经给出的身份是否打架。
 * 两边都得是有效身份才算数：游戏还没给身份时不算冲突。
 */
export function figureConflicts(candidate: unknown, known: unknown): boolean {
  return isIdentityFigure(candidate) && isIdentityFigure(known)
    && Number(candidate) !== Number(known);
}

/** 身份取值来源：账=账号锁定，名=昵称锁定，座=座位锁定，序=房间顺序，位=画面座位号兜底。 */
export type SeatFigureSource = '账' | '名' | '座' | '序' | '位' | '无';

export interface SeatFigureInput {
  /** 是不是本地玩家自己的座位。自己的身份由服务器给，扩展一律不写。 */
  isSelf: boolean;
  /** 按账号锁定的身份。 */
  byAccount?: number;
  /** 按昵称锁定的身份。 */
  byName?: number;
  /** 按座位号锁定的身份。 */
  bySeat?: number;
  /** 按房间座位顺序算出的身份。 */
  byRoomOrder?: number;
  /** 房间顺序还没认出来时，按画面座位号垫的身份。 */
  bySeatIndex?: number;
}

export interface SeatFigureDecision {
  figure: number;
  source: SeatFigureSource;
  /** 只有自己的座位不允许改写；其余座位 figure 大于 0 才写。 */
  writable: boolean;
}

/**
 * 座位身份的唯一取值入口。
 *
 * 顺序是「账号锁定 → 昵称锁定 → 座位锁定 → 房间顺序 → 画面座位号」，
 * 越靠前越可信：重连后账号可能读不到，昵称和座位锁定都是为这一步留的。
 *
 * 自己的座位无论算出什么都返回 writable=false。身份模式下游戏只在本地座位上做特殊处理：
 * 系统设置「默认开身份」开着就显示服务器给的真实身份，关着就把自己那格画成空图。
 * 扩展一写就把 figureValue 换成按座位顺序推出来的值，重连后顺序一变，
 * 主公就会被自己写成忠臣。
 */
export function resolveSeatFigure(input: SeatFigureInput): SeatFigureDecision {
  const candidates: Array<[SeatFigureSource, number | undefined]> = [
    ['账', input.byAccount],
    ['名', input.byName],
    ['座', input.bySeat],
    ['序', input.byRoomOrder],
    ['位', input.bySeatIndex]
  ];
  for (const [source, raw] of candidates) {
    const figure = Number(raw);
    if (Number.isInteger(figure) && figure > 0) {
      return { figure, source, writable: !input.isSelf };
    }
  }
  return { figure: 0, source: '无', writable: false };
}
