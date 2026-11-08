/** 从场景往下找后画图片时最多走这么多层。 */
export const HALL_BACKDROP_SEARCH_DEPTH = 6;

/** 不在子节点列表里、挂在这些字段上的底图也要看。 */
export const HALL_BACKDROP_IMAGE_KEYS = ['bg', 'background', 'bgSprite', 'imgBg', 'backBg'] as const;

/** 选模式页隔这么久再确认全图还在。 */
export const HALL_BACKDROP_REAPPLY_MS = 400;

/** 进牌局后隔这些时间再按已存背景盖一次，挡住游戏后画的球场。 */
export const MATCH_BACKGROUND_REAPPLY_DELAYS_MS = [0, 80, 160, 320, 640] as const;

/** 进牌局后等多久再看对局场景是否已经出现。 */
export const MATCH_BACKGROUND_SCENE_POLL_MS = 50;

/** 进牌局后最多看这么多次对局场景。 */
export const MATCH_BACKGROUND_SCENE_POLL_ATTEMPTS = 120;

/** 进桌后最多找这么久底图节点。 */
export const EARLY_BACKGROUND_SEEK_MS = 8000;

/** 盖上之后继续挡住游戏后画的球场。 */
export const EARLY_BACKGROUND_HOLD_MS = 2000;

/** 已经可以换图时，隔这么久再看底图是否被球场盖回去。 */
export const EARLY_BACKGROUND_APPLY_POLL_MS = 16;

/** 还在大厅时放慢查看。 */
export const EARLY_BACKGROUND_APPLY_WAIT_MS = 200;

/** 进桌或旁观后，隔这么久再设一次上次选的背景。 */
export const SAVED_WALLPAPER_REAPPLY_INTERVAL_MS = 400;

/** 进桌或旁观后最多设这么多次，避免大厅里反复设。 */
export const SAVED_WALLPAPER_REAPPLY_TIMES = 8;

/** 登录后隔这么久再找一次背景单例。 */
export const SAVED_WALLPAPER_HOOK_INTERVAL_MS = 250;

/** 登录后最多找这么多次背景单例。 */
export const SAVED_WALLPAPER_HOOK_ATTEMPTS = 80;

/** 首页山景上面盖全图。山景有像素后再藏，按钮留在图上面。 */
export const HALL_COVER_PLACE_OVER_SCENERY = 'over-scenery';

/** 房间列表和房间里：图只放在场景最底层，游戏画面留在上面。 */
export const HALL_COVER_PLACE_BEHIND_SCENE = 'behind-scene';

/** 牌局里用牌局自己的背景层，不往场景上再盖一张。 */
export const HALL_COVER_PLACE_MATCH = 'match';

export type HallCoverPlacement =
  | typeof HALL_COVER_PLACE_OVER_SCENERY
  | typeof HALL_COVER_PLACE_BEHIND_SCENE
  | typeof HALL_COVER_PLACE_MATCH;

/** 三页各走各的层。牌局优先，避免为了大厅把牌局盖住，或为了首页把房间列表抬到画面上面。 */
export function resolveHallCoverPlacement(input: {
  inMatch: boolean;
  hasModeScenery: boolean;
}): HallCoverPlacement {
  if (input.inMatch) return HALL_COVER_PLACE_MATCH;
  if (input.hasModeScenery) return HALL_COVER_PLACE_OVER_SCENERY;
  return HALL_COVER_PLACE_BEHIND_SCENE;
}

/** 全局背景关着时，已存的图只留在牌局里。首页、房间列表和别的页面不铺。 */
export function shouldApplyCustomBackgroundOnPage(input: {
  inMatch: boolean;
  globalBackgroundOn: boolean;
}): boolean {
  if (input.inMatch) return true;
  return input.globalBackgroundOn === true;
}

/** 顶栏返回按钮的构造器再往上两层，才是能后画的精灵。 */
export const HALL_FLAT_SPRITE_PROTOTYPE_HOPS = 2;

/** 在顶栏和背景层里找后画图片时，最多看这么多个节点。 */
export const HALL_FLAT_IMAGE_SCAN_LIMIT = 400;

/** 皮肤窗没有武将编号时不会把右侧大图建出来。 */
export const HALL_SKIN_WINDOW_PROBE_GENERAL_ID = 1;

/** 返回按钮的构造器沿着原型往上走几层。走不到函数就停。 */
export function constructorAfterPrototypeHops(
  start: unknown,
  hops: number
): (new () => unknown) | null {
  let current = start;
  for (let hop = 0; hop < hops; hop += 1) {
    if (typeof current !== 'function') return null;
    const parentPrototype = Object.getPrototypeOf(current.prototype);
    current = asConstructor(parentPrototype?.constructor);
  }
  return asConstructor(current);
}

function asConstructor(value: unknown): (new () => unknown) | null {
  return typeof value === 'function' ? value as new () => unknown : null;
}
