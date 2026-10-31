/** 大厅自动弹出的活动/广告窗类名，与 ShowWindow 参数一致。 */
export const LOBBY_AD_PUSH_WINDOW_NAMES = [
  'AdPushWindow',
  'NewAdPushWindow',
  'HallAdPushWindow',
  'ActivityPushWindow',
  'ModeAdPushWindow',
  'HallPopAdWindow',
  'ActivityPopWindow',
  'PopActivityWindow'
] as const;

/** ShowWindow 或 WindowManager 键名是否为大厅广告窗。 */
export function isLobbyAdPushWindowName(name: string): boolean {
  const trimmed = String(name ?? '').trim();
  if (!trimmed) return false;
  return (LOBBY_AD_PUSH_WINDOW_NAMES as readonly string[]).includes(trimmed);
}

const AD_CAROUSEL_SAFE_GUARD = /Mvp|Result|Package|Prob|SelectSkin|Login|Setting|Shop|Mail|Friend|Chat|Rank|Task/i;

/** 带轮播视图和 closeClicker 的活动弹层，用于新版未改类名的广告窗。 */
export function looksLikeAdPushCarouselWindow(
  windowRecord: Record<string, unknown> | null
): boolean {
  if (!windowRecord || windowRecord.destroyed) return false;
  const ctor = windowRecord.constructor as { name?: string } | undefined;
  const identity = `${String(windowRecord.name ?? '')}|${String(ctor?.name ?? '')}`;
  if (AD_CAROUSEL_SAFE_GUARD.test(identity)) return false;
  const views = windowRecord.curViewList;
  if (!Array.isArray(views) || !views.length) return false;
  const hasClose = views.some((view) => typeof (view as Record<string, unknown>)?.closeClicker === 'function');
  if (!hasClose) return false;
  return /Ad|Push|Pop|Banner|Activity|Act|Hall/i.test(identity);
}
