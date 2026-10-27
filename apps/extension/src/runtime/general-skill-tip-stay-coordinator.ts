/**
 * 武将/技能 tip 停驻：出关钮后进入 r$t.staticTip2，移开鼠标不关；点 X/空白走原生 onCheckStaticTip2。
 *
 * 预提升失败主因（探针 TipsHide+staticName空+view=0）：
 * 1) 技能 tip 常在 hKi.ShowTip/currentTip，不在 r$t.viewArr——只扫 viewArr 升不上去；
 * 2) hKi.stageTipClickHandler 会 removeChild+destroy currentTip，与 TipsHide 无关；
 * 3) cancelStayTimers 若在 promote 成功前清掉原生 once，会拆掉唯一原生停驻路径。
 *
 * 做法：宽搜 SkillToolTip/GGT（viewArr+hKi）→ 出 X 后写入 staticTip2；
 * stageTipClickHandler 对已出 X 的技能 tip 改为 adopt 到 staticTip2 而非 destroy；
 * clearTips2 守卫挡未包装 once；TipsHide 先宽搜晋升再放行。不碰包裹 tip 逻辑。
 */

import { createLayaObjectLocator, type LayaRuntimeWindow } from '../adapters/laya-object-locator.ts';
import {
  isGameSeatUiFlowActive,
  isSystemConfirmWindowOpen,
} from './game-native-dialog.ts';
import { GAME_TIP_LAYER_Z } from './game-tip-layer.ts';
import { createMethodPatcher } from './method-patch.ts';

/** 武将技能相关 tip；道具等其它 tip 不碰 */
/** 武将详情 + 技能面板（二者都有 timeAni/关钮/stay） */
const STAY_TIP_NAMES = new Set(['GameGeneralToolTip', 'SkillToolTip']);
const TIP_CLICK_BOUND = '__xcGeneralSkillTipClickBound';
const CLOSE_BTN_BOUND = '__xcGeneralSkillTipCloseBtnBound';
const TIP_STAY_ARMED = '__xcGeneralSkillTipStayArmed';
const TIP_OTC_WRAPPED = '__xcGeneralSkillTipOtcWrapped';
const TIME_ANI_OTC_BOUND = '__xcGeneralSkillTipTimeAniOtcBound';
/** 出 X 前已预提升，TipsHide 不得再毁 */
const TIP_STAY_PREPROMOTED = '__xcGeneralSkillTipStayPrepromoted';
let nativeCheckButtonMode: NativeFn | null = null;
const wrappedCloseBtnHandlers = new WeakSet<NativeFn>();
/** tipsShow/once 绑定的是包装前的函数引用；取消定时器必须用这些原引用 */
let nativeOnChangeTipToStay: NativeFn | null = null;
let nativeOnStartStayToolTip: NativeFn | null = null;
let nativeClearTips2: NativeFn | null = null;
/** onCheckStaticTip2 / userClosing 期间放行 clearTips2 */
let allowClearStayedSkillTip = false;
let cachedTipManager: UnknownRecord | null = null;

type UnknownRecord = Record<string, unknown>;
type NativeFn = (...args: unknown[]) => unknown;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function isTipManager(value: UnknownRecord | null): value is UnknownRecord {
  return Boolean(
    value
    && typeof value.TipsHide === 'function'
    && typeof value.OnChangeTipToStay === 'function'
    && Array.isArray(value.viewArr)
    && 'staticTip2' in value
  );
}

function isGeneralSkillTip(tip: UnknownRecord): boolean {
  return STAY_TIP_NAMES.has(String(tip.name ?? '')) && tip.destroyed !== true;
}

function isStayProtectedTip(tip: UnknownRecord | null): boolean {
  if (!tip || !isGeneralSkillTip(tip)) return false;
  return tip[TIP_STAY_PREPROMOTED] === true || tip[TIP_STAY_ARMED] === true;
}

/** 静默探针：只写 window.__xcTipStayLastClose，默认不打 console */
function recordLastClose(globalObject: LayaRuntimeWindow, reason: string, detail?: UnknownRecord): void {
  const bag = globalObject as UnknownRecord;
  const entry = {
    t: Date.now(),
    reason,
    ...(detail ?? {}),
  };
  bag.__xcTipStayLastClose = entry;
  const arr = Array.isArray(bag.__xcTipStayCloseLog) ? bag.__xcTipStayCloseLog as unknown[] : [];
  arr.push(entry);
  while (arr.length > 20) arr.shift();
  bag.__xcTipStayCloseLog = arr;
  try {
    if (bag.__xcTipStayDebug === true) {
      (console.log as (...args: unknown[]) => void)('[xcTipStay] close:' + reason, detail ?? '');
    }
  } catch { /* ignore */ }
}

function tipStayStats(globalObject: LayaRuntimeWindow): UnknownRecord {
  const bag = globalObject as UnknownRecord;
  let stats = asRecord(bag.__xcTipStayStats);
  if (!stats) {
    stats = {
      promoteOk: 0,
      promoteFail: 0,
      armCount: 0,
      bindCount: 0,
      tipsHideWithView: 0,
      tipsHideEmpty: 0,
      stageTipClickBlocked: 0,
      lastPromoteOkAt: 0,
      lastPromoteFail: '',
      lastTipsHideStack: '',
      tipNamesSeen: [],
    };
    bag.__xcTipStayStats = stats;
  }
  return stats;
}

function notePromoteResult(
  globalObject: LayaRuntimeWindow,
  ok: boolean,
  tip: UnknownRecord | null,
  why: string,
): void {
  const stats = tipStayStats(globalObject);
  const name = tip ? String(tip.name ?? '') : '';
  if (ok) {
    stats.promoteOk = Number(stats.promoteOk ?? 0) + 1;
    stats.lastPromoteOkAt = Date.now();
  } else {
    stats.promoteFail = Number(stats.promoteFail ?? 0) + 1;
    stats.lastPromoteFail = why + (name ? (' name=' + name) : '');
    bagSet(globalObject, '__xcTipStayLastPromoteFail', { t: Date.now(), why, name });
  }
}

function bagSet(globalObject: LayaRuntimeWindow, key: string, value: unknown): void {
  try { (globalObject as UnknownRecord)[key] = value; } catch { /* ignore */ }
}

function stackSummary(limit = 800): string {
  try {
    const err = new Error('tipstay');
    return String(err.stack ?? '').split('\n').slice(2, 10).join(' | ').slice(0, limit);
  } catch {
    return '';
  }
}

function readPromptLayer(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  try {
    const locator = createLayaObjectLocator(globalObject);
    // prompt 层常见名
    for (const name of ['PromptLayer', 'promptLayer', 'hKi']) {
      try {
        const layer = asRecord(locator.layer?.(name));
        if (layer && ('currentTip' in layer || typeof layer.ShowTip === 'function')) return layer;
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
  try {
    const getClass = globalObject.Laya?.ClassUtils?.getClass;
    if (typeof getClass === 'function') {
      for (const name of ['hKi', 'PromptLayer']) {
        const ctor = getClass.call(globalObject.Laya?.ClassUtils, name) as { I?: () => unknown } | undefined;
        const inst = asRecord(typeof ctor?.I === 'function' ? ctor.I() : null);
        if (inst && ('currentTip' in inst || typeof inst.ShowTip === 'function')) return inst;
      }
    }
  } catch { /* ignore */ }
  try {
    const stage = asRecord(globalObject.Laya?.stage);
    const n = Number(stage?.numChildren ?? 0);
    const getAt = stage && (stage as { getChildAt?: (i: number) => unknown }).getChildAt;
    if (typeof getAt === 'function') {
      for (let i = 0; i < n && i < 40; i += 1) {
        const ch = asRecord(getAt.call(stage, i));
        if (ch && 'currentTip' in ch && typeof ch.ShowTip === 'function') return ch;
      }
    }
  } catch { /* ignore */ }
  // 从 tip manager 事件/全局单例旁路：有 ShowTip 的节点
  try {
    const locator = createLayaObjectLocator(globalObject);
    const found = locator.findManagerByPredicate((candidate) => {
      const rec = asRecord(candidate);
      return Boolean(rec && 'currentTip' in rec && typeof rec.ShowTip === 'function' && typeof rec.stageTipClickHandler === 'function');
    });
    if (found) return found;
  } catch { /* ignore */ }
  return null;
}

function collectSkillTipsWide(
  globalObject: LayaRuntimeWindow,
  manager: UnknownRecord | null,
): UnknownRecord[] {
  const found: UnknownRecord[] = [];
  const visit = (raw: unknown) => {
    const tip = asRecord(raw);
    if (!tip || !isGeneralSkillTip(tip)) return;
    if (!found.includes(tip)) found.push(tip);
    const stats = tipStayStats(globalObject);
    const names = Array.isArray(stats.tipNamesSeen) ? stats.tipNamesSeen as string[] : [];
    const name = String(tip.name ?? '');
    if (name && !names.includes(name)) {
      names.push(name);
      while (names.length > 10) names.shift();
      stats.tipNamesSeen = names;
    }
  };
  if (manager) {
    visit(manager.staticTip2);
    visit(manager.currentTip);
    if (Array.isArray(manager.viewArr)) manager.viewArr.forEach(visit);
  }
  const prompt = readPromptLayer(globalObject);
  if (prompt) {
    visit(prompt.currentTip);
    const n = Number(prompt.numChildren ?? 0);
    const getAt = (prompt as { getChildAt?: (i: number) => unknown }).getChildAt;
    if (typeof getAt === 'function') {
      for (let i = 0; i < n && i < 60; i += 1) visit(getAt.call(prompt, i));
    }
  }
  return found;
}

function detachSkillTipFromPromptLayer(
  globalObject: LayaRuntimeWindow,
  tip: UnknownRecord,
): void {
  const prompt = readPromptLayer(globalObject);
  if (!prompt) return;
  if (prompt.currentTip !== tip) return;
  try { prompt.currentTip = null; } catch { /* ignore */ }
  try {
    const stage = asRecord(globalObject.Laya?.stage);
    const handler = prompt.stageTipClickHandler;
    if (stage && typeof stage.off === 'function' && typeof handler === 'function') {
      const Ev = asRecord(asRecord(globalObject.Laya)?.Event);
      (stage.off as NativeFn).call(stage, Ev?.CLICK ?? 'click', prompt, handler);
      (stage.off as NativeFn).call(stage, Ev?.MOUSE_WHEEL ?? 'mousewheel', prompt, handler);
    }
  } catch { /* ignore */ }
}


/**
 * 关闭按钮已出现即可停驻。
 * 不用 closeBtn._visible===false 一票否决（与 visible 偶发不一致）。
 */
function tipCloseButtonVisible(tip: UnknownRecord): boolean {
  if (!isGeneralSkillTip(tip)) return false;
  const closeBtn = asRecord(tip.closeBtn);
  if (!closeBtn || closeBtn.destroyed === true) return false;
  if (closeBtn.visible === true || closeBtn._visible === true) return true;
  if (closeBtn.visible === false && closeBtn._visible === false) return false;
  if (closeBtn.parent) return true;
  return closeBtn.visible !== false;
}

function isVisibleGeneralTip(tip: UnknownRecord): boolean {
  if (!isGeneralSkillTip(tip)) return false;
  if (tip.visible === false || tip._visible === false) return false;
  const alpha = Number(tip.alpha);
  if (Number.isFinite(alpha) && alpha <= 0.01) return false;
  return true;
}

function collectManagerTips(manager: UnknownRecord | null): UnknownRecord[] {
  if (!manager) return [];
  const found: UnknownRecord[] = [];
  const visit = (raw: unknown) => {
    const tip = asRecord(raw);
    if (!tip || !isGeneralSkillTip(tip)) return;
    if (!found.includes(tip)) found.push(tip);
  };
  visit(manager.staticTip2);
  visit(manager.currentTip);
  if (Array.isArray(manager.viewArr)) manager.viewArr.forEach(visit);
  return found;
}

function collectVisibleGeneralTips(manager: UnknownRecord | null): UnknownRecord[] {
  return collectManagerTips(manager).filter(isVisibleGeneralTip);
}

/** 停驻未关时，另有新武将 tip 正在展开（关闭按钮尚未出现）。 */
function hasReplacingHoverTip(manager: UnknownRecord | null): boolean {
  if (!manager) return false;
  const staticTip = asRecord(manager.staticTip2);
  if (!staticTip || !tipCloseButtonVisible(staticTip) || !isVisibleGeneralTip(staticTip)) return false;
  for (const tip of collectVisibleGeneralTips(manager)) {
    if (tip === staticTip) continue;
    if (!tipCloseButtonVisible(tip)) return true;
  }
  return false;
}

function collectStayTips(manager: UnknownRecord | null): UnknownRecord[] {
  return collectManagerTips(manager).filter(tipCloseButtonVisible);
}

function timeAniCompleted(tip: UnknownRecord): boolean {
  const timeAni = asRecord(tip.timeAni);
  if (!timeAni) return false;
  const total = Number(timeAni.totalTime);
  const remaining = Number(timeAni.remainingTime);
  if (!Number.isFinite(total) || total <= 0) return false;
  if (!Number.isFinite(remaining)) return false;
  return remaining >= total;
}

/** TipsHide 前应保住的 tip：已出 X、倒计时已走完、或已预提升。 */
function shouldProtectFromTipsHide(tip: UnknownRecord): boolean {
  if (!isGeneralSkillTip(tip)) return false;
  if (tip[TIP_STAY_PREPROMOTED] === true || tip[TIP_STAY_ARMED] === true) return true;
  if (tipCloseButtonVisible(tip)) return true;
  if (timeAniCompleted(tip)) return true;
  return false;
}

function readManagerFromEvents(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  const locator = createLayaObjectLocator(globalObject);
  const fromPredicate = locator.findManagerByPredicate((candidate) => isTipManager(candidate));
  if (fromPredicate) return fromPredicate;

  const events = asRecord(locator.dispatcher()?._events);
  if (!events) return null;
  for (const bucket of Object.values(events)) {
    const list = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
    for (const handler of list) {
      const caller = asRecord(asRecord(handler)?.caller);
      if (isTipManager(caller)) return caller;
    }
  }
  return null;
}

function readManager(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  if (isTipManager(cachedTipManager) && cachedTipManager.destroyed !== true) {
    return cachedTipManager;
  }
  cachedTipManager = null;
  const found = readManagerFromEvents(globalObject);
  if (found) cachedTipManager = found;
  return found;
}

function readPrototype(
  globalObject: LayaRuntimeWindow,
  className: string,
  methodName: string,
  instance: UnknownRecord | null
): UnknownRecord | null {
  if (className) {
    try {
      const ctor = globalObject.Laya?.ClassUtils?.getClass?.(className);
      const fromClass = asRecord(typeof ctor === 'function' ? (ctor as { prototype?: unknown }).prototype : null);
      if (fromClass && typeof fromClass[methodName] === 'function') return fromClass;
    } catch {
      // 忽略。
    }
  }
  if (!instance) return null;
  let proto = asRecord(Object.getPrototypeOf(instance));
  const seen = new Set<object>();
  while (proto && !seen.has(proto)) {
    seen.add(proto);
    if (typeof proto[methodName] === 'function') return proto;
    proto = asRecord(Object.getPrototypeOf(proto));
  }
  return null;
}

function isBlockingGameWindowOpen(globalObject: LayaRuntimeWindow): boolean {
  if (isGameSeatUiFlowActive(globalObject)) return false;
  return isSystemConfirmWindowOpen(globalObject);
}

function ensureTipAboveExtension(tip: UnknownRecord): void {
  const minZ = GAME_TIP_LAYER_Z - 1;
  if (Number(tip.zOrder) < minZ) tip.zOrder = minZ;
  const parent = asRecord(tip.parent);
  if (typeof parent?.sortChildren === 'function') {
    try {
      (parent.sortChildren as NativeFn).call(parent);
    } catch {
      // 忽略。
    }
  }
}

/** 只停 checkButtonMode，绝不 clearAll(manager)——会误伤其它逻辑，且不必。 */
function stopCheckButtonLoop(globalObject: LayaRuntimeWindow, manager: UnknownRecord): void {
  const timer = asRecord(globalObject.Laya?.timer);
  manager.addLoop = false;
  if (typeof timer?.clear !== 'function') return;
  for (const fn of [manager.checkButtonMode, nativeCheckButtonMode]) {
    if (typeof fn !== 'function') continue;
    try {
      (timer.clear as NativeFn).call(timer, manager, fn);
    } catch {
      // 忽略。
    }
  }
}

function withUserClosing<T>(tip: UnknownRecord, userClosing: WeakSet<object>, run: () => T): T {
  userClosing.add(tip);
  try {
    return run();
  } finally {
    userClosing.delete(tip);
  }
}

function bindCloseBtnHandlers(tip: UnknownRecord, userClosing: WeakSet<object>): void {
  const closeBtn = asRecord(tip.closeBtn);
  if (!closeBtn || closeBtn[CLOSE_BTN_BOUND]) return;
  const events = asRecord(closeBtn._events);
  if (!events) return;
  for (const bucket of Object.values(events)) {
    const handlers = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
    for (const raw of handlers) {
      const handler = asRecord(raw);
      const method = handler?.method;
      if (typeof method !== 'function') continue;
      const originalMethod = method as NativeFn;
      if (wrappedCloseBtnHandlers.has(originalMethod)) continue;
      const caller = handler.caller ?? closeBtn;
      const wrapped: NativeFn = (...args: unknown[]) => (
        withUserClosing(tip, userClosing, () => originalMethod.apply(caller, args))
      );
      wrappedCloseBtnHandlers.add(wrapped);
      handler.method = wrapped;
    }
  }
  closeBtn[CLOSE_BTN_BOUND] = true;
}

function bindTipCloseClick(tip: UnknownRecord, userClosing: WeakSet<object>): void {
  if (!tip[TIP_CLICK_BOUND]) {
    const original = tip.clickSprite;
    if (typeof original === 'function') {
      tip.clickSprite = (...args: unknown[]) => (
        withUserClosing(tip, userClosing, () => (original as NativeFn).apply(tip, args))
      );
    }
    tip[TIP_CLICK_BOUND] = true;
  }
  bindCloseBtnHandlers(tip, userClosing);
}

/**
 * 按引用移出 viewArr → staticTip2（对齐原生 OnChangeTipToStay 的结果）。
 * 不调用原生 OnChangeTipToStay：它会先 clearTips2，在 viewArr 还有其它 tip 时会误杀已停驻。
 * 不在此处绑 stage click 以外的销毁逻辑；stage click 交给原生 onCheckStaticTip2（点空白关闭）。
 */

/** 取消 tipsShow 预约的迟到 OnChangeTipToStay（once 存的是原函数引用）。 */
function cancelStayTimers(globalObject: LayaRuntimeWindow, manager: UnknownRecord): void {
  const timer = asRecord(globalObject.Laya?.timer);
  if (!timer || typeof timer.clear !== 'function') return;
  const clear = timer.clear as NativeFn;
  const methods = new Set<NativeFn>();
  const add = (fn: unknown) => {
    if (typeof fn === 'function') methods.add(fn as NativeFn);
  };
  add(nativeOnChangeTipToStay);
  add(nativeOnStartStayToolTip);
  add(manager.OnChangeTipToStay);
  add(manager.onStartStayToolTip);
  const proto = asRecord(Object.getPrototypeOf(manager));
  if (proto) {
    add(proto.OnChangeTipToStay);
    add(proto.onStartStayToolTip);
  }
  for (const fn of methods) {
    try { clear.call(timer, manager, fn); } catch { /* ignore */ }
  }
  // 再按函数名扫一遍（once 可能绑了 bind 后的别名）
  for (const key of ['_handlers', 'handlers'] as const) {
    const bag = timer[key];
    if (!Array.isArray(bag)) continue;
    for (const raw of [...bag]) {
      const h = asRecord(raw);
      if (!h || h.caller !== manager) continue;
      const method = h.method;
      if (typeof method !== 'function') continue;
      const name = String((method as NativeFn).name ?? '');
      if (/OnChangeTipToStay|onStartStayToolTip/i.test(name)) {
        try { clear.call(timer, manager, method); } catch { /* ignore */ }
      }
    }
  }
  // 扫 Laya.timer 内部队列，按 caller+原方法名清掉漏网 once
  for (const key of ['_handlers', 'handlers', '_map', 'map'] as const) {
    const bag = timer[key];
    if (!Array.isArray(bag)) continue;
    for (const raw of bag) {
      const h = asRecord(raw);
      if (!h || h.caller !== manager) continue;
      const method = h.method;
      if (typeof method !== 'function') continue;
      if (
        method === nativeOnChangeTipToStay
        || method === nativeOnStartStayToolTip
        || method === manager.OnChangeTipToStay
        || method === manager.onStartStayToolTip
        || (proto && (method === proto.OnChangeTipToStay || method === proto.onStartStayToolTip))
      ) {
        try { clear.call(timer, manager, method); } catch { /* ignore */ }
      }
    }
  }
}

function promoteTipToStaticStay(
  globalObject: LayaRuntimeWindow,
  manager: UnknownRecord,
  tip: UnknownRecord,
): boolean {
  if (!tip) {
    notePromoteResult(globalObject, false, null, 'no-tip');
    return false;
  }
  if (!isGeneralSkillTip(tip)) {
    notePromoteResult(globalObject, false, tip, 'not-skill-tip');
    return false;
  }
  if (tip.destroyed === true) {
    notePromoteResult(globalObject, false, tip, 'destroyed');
    return false;
  }

  const viewArr = Array.isArray(manager.viewArr) ? manager.viewArr as unknown[] : null;
  if (viewArr) {
    const index = viewArr.indexOf(tip);
    if (index >= 0) viewArr.splice(index, 1);
  }

  detachSkillTipFromPromptLayer(globalObject, tip);

  if (manager.staticTip2 === tip) {
    tip[TIP_STAY_PREPROMOTED] = true;
    cancelStayTimers(globalObject, manager);
    ensureStageClickForStay(globalObject, manager);
    notePromoteResult(globalObject, true, tip, 'already-static');
    return true;
  }

  if (manager.staticTip2 && manager.staticTip2 !== tip) {
    const old = asRecord(manager.staticTip2);
    if (old && isGeneralSkillTip(old) && typeof manager.clearTips2 === 'function') {
      allowClearStayedSkillTip = true;
      try {
        (manager.clearTips2 as NativeFn).call(manager);
      } catch {
        // 忽略。
      } finally {
        allowClearStayedSkillTip = false;
      }
    } else if (old && !isGeneralSkillTip(old) && old.destroyed !== true) {
      try { old.visible = false; } catch { /* ignore */ }
      manager.staticTip2 = null;
    }
  }

  manager.staticTip2 = tip;
  tip.zOrder = GAME_TIP_LAYER_Z - 1;
  tip[TIP_STAY_PREPROMOTED] = true;
  ensureTipAboveExtension(tip);

  try {
    if (!tip.parent) {
      const prompt = readPromptLayer(globalObject);
      if (prompt && typeof prompt.addChild === 'function') {
        (prompt.addChild as NativeFn).call(prompt, tip);
      }
    }
  } catch { /* ignore */ }

  // 仅成功写入后再取消原生 once
  cancelStayTimers(globalObject, manager);
  ensureStageClickForStay(globalObject, manager);

  const ok = manager.staticTip2 === tip && tip.destroyed !== true;
  notePromoteResult(globalObject, ok, tip, ok ? 'set-staticTip2' : 'staticTip2-mismatch');
  return ok;
}

function ensureStageClickForStay(globalObject: LayaRuntimeWindow, manager: UnknownRecord): void {
  const stage = asRecord(globalObject.Laya?.stage);
  const onCheck = manager.onCheckStaticTip2;
  if (!stage || typeof onCheck !== 'function') return;
  const laya = asRecord(globalObject.Laya);
  const eventBag = asRecord(laya?.Event);
  const click = (typeof eventBag?.CLICK === 'string' || typeof eventBag?.CLICK === 'number')
    ? eventBag.CLICK
    : 'click';
  try {
    // 先 off 再 on，避免重复监听；不在注册时触发回调
    if (typeof stage.off === 'function') {
      (stage.off as NativeFn).call(stage, click, manager, onCheck);
    }
    if (typeof stage.on === 'function') {
      (stage.on as NativeFn).call(stage, click, manager, onCheck);
    }
  } catch {
    // 忽略。
  }
}

/**
 * TipsHide 前：把应停驻的技能 tip 移出 viewArr。
 * 含「倒计时已完但 closeBtn 尚未赋值」的同一拍窗口。
 */
function promoteStayEligibleTips(
  globalObject: LayaRuntimeWindow,
  manager: UnknownRecord,
): void {
  const viewArr = Array.isArray(manager.viewArr) ? manager.viewArr.slice() : [];
  for (const raw of viewArr) {
    const tip = asRecord(raw);
    if (!tip || !shouldProtectFromTipsHide(tip)) continue;
    if (tip === manager.staticTip2) continue;
    promoteTipToStaticStay(globalObject, manager, tip);
  }
}

/**
 * 关闭按钮已出现后的收尾：绑 X、停鼠标离开检测、确保在 staticTip2。
 * 预提升已在 onTimeComplete 前完成。
 */
function enterStayWhenCloseAppeared(
  globalObject: LayaRuntimeWindow,
  manager: UnknownRecord,
  tip: UnknownRecord,
  userClosing: WeakSet<object>,
): void {
  if (!isGeneralSkillTip(tip)) return;
  // 允许「预提升后 closeBtn 刚显示」或「复用 tip 直接显示 X」
  if (!tipCloseButtonVisible(tip) && tip[TIP_STAY_PREPROMOTED] !== true) return;

  const firstArm = tip[TIP_STAY_ARMED] !== true;
  ensureTipAboveExtension(tip);
  bindTipCloseClick(tip, userClosing);

  if (tip !== manager.staticTip2) {
    promoteTipToStaticStay(globalObject, manager, tip);
  } else if (firstArm) {
    // 仅首次：取消迟到 OnChangeTipToStay；勿每 50ms clear（会误清包裹 tip 的 stay once）
    cancelStayTimers(globalObject, manager);
    ensureStageClickForStay(globalObject, manager);
  }

  // 不停 checkButtonMode：TipsHide 毁不到 staticTip2；停 loop 会让后续包裹 tip 悬停检测失灵。
  tip[TIP_STAY_ARMED] = true;
  tip[TIP_STAY_PREPROMOTED] = true;
}

/**
 * 关键：在原生 onTimeComplete 之前预提升。
 * 原生会 timeAni.visible=false 并 addChild(closeBtn)，常同步触发 TIPS_OUT→TipsHide。
 */
function wrapOnTimeCompleteForStay(
  globalObject: LayaRuntimeWindow,
  manager: UnknownRecord,
  tip: UnknownRecord,
  userClosing: WeakSet<object>,
  original: NativeFn,
): NativeFn {
  return function (this: unknown, ...args: unknown[]) {
    const self = asRecord(this) ?? tip;
    const mgr = readManager(globalObject) ?? manager;
    if (mgr && isGeneralSkillTip(self)) {
      // 先离开 viewArr，再让原生改节点；同步 TipsHide 毁不到它
      promoteTipToStaticStay(globalObject, mgr, self);
    }
    const result = original.apply(this, args);
    if (mgr && isGeneralSkillTip(self)) {
      enterStayWhenCloseAppeared(globalObject, mgr, self, userClosing);
    }
    return result;
  };
}


/** timeAni 构造时 bind 了原 onTimeComplete；须重写 onComplete，否则 OTC wrap 永不触发。 */
function bindTimeAniOnComplete(
  globalObject: LayaRuntimeWindow,
  manager: UnknownRecord,
  tip: UnknownRecord,
  userClosing: WeakSet<object>,
): void {
  const timeAni = asRecord(tip.timeAni);
  if (!timeAni) return;
  const otc = tip.onTimeComplete;
  if (typeof otc !== 'function') return;
  // 必须绑当前 tip.onTimeComplete（含 OTC wrap）；原生构造时 setOnComplete 绑的是原函数
  const bound = (otc as NativeFn).bind(tip);
  timeAni.onComplete = bound;
  if (typeof timeAni.setOnComplete === 'function') {
    try { (timeAni.setOnComplete as NativeFn).call(timeAni, bound); } catch { /* ignore */ }
  }
  // 兼容 Hjt 内部字段
  for (const key of ['_onComplete', 'onCompleteHandler', 'completeHandler', '_completeHandler']) {
    if (key in timeAni) {
      try { timeAni[key] = bound; } catch { /* ignore */ }
    }
  }
  const first = timeAni[TIME_ANI_OTC_BOUND] !== true;
  timeAni[TIME_ANI_OTC_BOUND] = true;
  if (first) {
    tipStayStats(globalObject).bindCount = Number(tipStayStats(globalObject).bindCount ?? 0) + 1;
    tipStayDebug(globalObject, 'bindTimeAni', String(tip.name ?? ''));
  }
}

const tipStayDebugOnce = new Set<string>();
function tipStayDebug(globalObject: LayaRuntimeWindow, tag: string, detail?: string): void {
  const bag = globalObject as UnknownRecord;
  // 默认静默；仅显式 true 才打，且同 tip+tag 只打一次，避免 50ms tick 刷屏
  if (bag.__xcTipStayDebug !== true) return;
  const key = tag + '|' + (detail ?? '');
  if (tipStayDebugOnce.has(key)) return;
  tipStayDebugOnce.add(key);
  if (tipStayDebugOnce.size > 200) tipStayDebugOnce.clear();
  try {
    const line = '[xcTipStay] ' + tag + (detail ? (' ' + detail) : '');
    (console.log as (...args: unknown[]) => void)(line);
    const arr = Array.isArray(bag.__xcTipStayDebugLog) ? bag.__xcTipStayDebugLog as unknown[] : [];
    arr.push({ t: Date.now(), tag, detail: detail ?? '' });
    while (arr.length > 40) arr.shift();
    bag.__xcTipStayDebugLog = arr;
  } catch { /* ignore */ }
}

function armTipCloseAppearStay(
  globalObject: LayaRuntimeWindow,
  manager: UnknownRecord,
  tip: UnknownRecord,
  userClosing: WeakSet<object>,
): void {
  if (!isGeneralSkillTip(tip)) return;

  if (tip[TIP_OTC_WRAPPED] !== true && typeof tip.onTimeComplete === 'function') {
    const original = tip.onTimeComplete as NativeFn;
    const wrapped = wrapOnTimeCompleteForStay(globalObject, manager, tip, userClosing, original);
    tip.onTimeComplete = wrapped;
    tip[TIP_OTC_WRAPPED] = true;
    tipStayStats(globalObject).armCount = Number(tipStayStats(globalObject).armCount ?? 0) + 1;
  }

  bindTimeAniOnComplete(globalObject, manager, tip, userClosing);

  // 倒计时已走完但尚未预提升（漏绑 setOnComplete 时）
  if (timeAniCompleted(tip) && tip !== manager.staticTip2) {
    promoteTipToStaticStay(globalObject, manager, tip);
  }

  if (tipCloseButtonVisible(tip)) {
    enterStayWhenCloseAppeared(globalObject, manager, tip, userClosing);
  }
}

function forceDismissStayTips(
  globalObject: LayaRuntimeWindow,
  manager: UnknownRecord | null,
): void {
  if (!manager) return;
  const staticTip = asRecord(manager.staticTip2);
  if (!staticTip || !isGeneralSkillTip(staticTip)) return;
  allowClearStayedSkillTip = true;
  try {
    if (typeof manager.clearTips2 === 'function') {
      (manager.clearTips2 as NativeFn).call(manager);
    }
  } catch { /* ignore */ }
  finally {
    allowClearStayedSkillTip = false;
  }
  recordLastClose(globalObject, 'forceDismiss', { name: String(staticTip.name ?? '') });
}

export function installGeneralSkillTipStayCoordinator(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): () => void {
  const bag = globalObject as Record<string, unknown>;
  const prevDispose = bag.__xcGeneralSkillTipStayDispose;
  if (typeof prevDispose === 'function') {
    try { (prevDispose as () => void)(); } catch { /* ignore */ }
  }
  const userClosing = new WeakSet<object>();
  const patcher = createMethodPatcher();
  const tipProtosReady = new WeakSet<object>();
  let managerProtoReady = false;
  cachedTipManager = null;

  function rebindStayStateListeners(manager: UnknownRecord, wrappedOnChange: NativeFn): void {
    const locator = createLayaObjectLocator(globalObject);
    const ged = asRecord(locator.dispatcher());
    if (!ged) return;
    const events = asRecord(ged._events);
    if (!events) return;
    for (const bucket of Object.values(events)) {
      const list = Array.isArray(bucket) ? bucket : bucket ? [bucket] : [];
      for (const raw of list) {
        const handler = asRecord(raw);
        if (!handler || handler.caller !== manager) continue;
        const method = handler.method;
        if (typeof method !== 'function') continue;
        if (
          method === nativeOnChangeTipToStay
          || method === manager.OnChangeTipToStay
          || (nativeOnChangeTipToStay && method === nativeOnChangeTipToStay)
        ) {
          handler.method = wrappedOnChange;
        }
      }
    }
  }

  function installManagerProto(manager: UnknownRecord): void {
    if (managerProtoReady) return;
    const proto = readPrototype(globalObject, '', 'TipsHide', manager);
    if (!proto) return;
    if (typeof proto.checkButtonMode === 'function') {
      nativeCheckButtonMode = proto.checkButtonMode as NativeFn;
    } else if (typeof manager.checkButtonMode === 'function') {
      nativeCheckButtonMode = manager.checkButtonMode as NativeFn;
    }
    if (typeof proto.onStartStayToolTip === 'function' && !nativeOnStartStayToolTip) {
      nativeOnStartStayToolTip = proto.onStartStayToolTip as NativeFn;
    } else if (typeof manager.onStartStayToolTip === 'function' && !nativeOnStartStayToolTip) {
      nativeOnStartStayToolTip = manager.onStartStayToolTip as NativeFn;
    }
    if (typeof proto.clearTips2 === 'function') {
      nativeClearTips2 = proto.clearTips2 as NativeFn;
    }

    // TipsHide：先把应停驻的技能 tip 移出 viewArr，再放行原生（不吞；包裹 tip 仍在 viewArr 正常被清）
    if (typeof proto.TipsHide === 'function') {
      patcher.wrap(proto, 'TipsHide', (original) => function (this: unknown, ...args: unknown[]) {
        const self = asRecord(this);
        if (self) {
          const before = Array.isArray(self.viewArr) ? self.viewArr.length : -1;
          for (const tip of collectSkillTipsWide(globalObject, self)) {
            if (shouldProtectFromTipsHide(tip) && tip !== self.staticTip2) {
              promoteTipToStaticStay(globalObject, self, tip);
            }
          }
          promoteStayEligibleTips(globalObject, self);
          const staticTip = asRecord(self.staticTip2);
          const stats = tipStayStats(globalObject);
          if (before > 0) stats.tipsHideWithView = Number(stats.tipsHideWithView ?? 0) + 1;
          else stats.tipsHideEmpty = Number(stats.tipsHideEmpty ?? 0) + 1;
          const stack = stackSummary();
          if (before > 0 || staticTip) stats.lastTipsHideStack = stack;
          recordLastClose(globalObject, 'TipsHide', {
            beforeView: before,
            afterView: Array.isArray(self.viewArr) ? self.viewArr.length : -1,
            staticName: staticTip ? String(staticTip.name ?? '') : '',
            wideCount: collectSkillTipsWide(globalObject, self).length,
            stack: before > 0 ? stack : undefined,
          });
        }
        return original.apply(this, args);
      });
    }

    /**
     * 真杀拦截：已停驻技能 tip 的 clearTips2。
     * 原版 once(OnChangeTipToStay) 即使绕过原型 wrap，最终也走这里。
     * 仅 onCheckStaticTip2（点 X/空白）与 userClosing 放行 —— 非全局吞 clearTips2。
     */
    if (typeof proto.clearTips2 === 'function') {
      patcher.wrap(proto, 'clearTips2', (original) => function (this: unknown, ...args: unknown[]) {
        const self = asRecord(this);
        const tip = self ? asRecord(self.staticTip2) : null;
        if (tip && isStayProtectedTip(tip) && !allowClearStayedSkillTip && !userClosing.has(tip)) {
          recordLastClose(globalObject, 'clearTips2:BLOCK', {
            name: String(tip.name ?? ''),
            allow: allowClearStayedSkillTip,
          });
          return undefined;
        }
        recordLastClose(globalObject, 'clearTips2:allow', {
          name: tip ? String(tip.name ?? '') : '',
          allow: allowClearStayedSkillTip,
          protected: isStayProtectedTip(tip),
        });
        return original.apply(this, args);
      });
    }

    // 点空白 / EVENT2(false) / 点 X：放行 clearTips2
    if (typeof proto.onCheckStaticTip2 === 'function') {
      patcher.wrap(proto, 'onCheckStaticTip2', (original) => function (this: unknown, ...args: unknown[]) {
        recordLastClose(globalObject, 'onCheckStaticTip2', { arg0: args[0] });
        allowClearStayedSkillTip = true;
        try {
          return original.apply(this, args);
        } finally {
          allowClearStayedSkillTip = false;
        }
      });
    }

    // 只 wrap OnChangeTipToStay（停驻路径）；TIPS_OUT 不 wrap
    if (typeof proto.OnChangeTipToStay === 'function') {
      patcher.wrap(proto, 'OnChangeTipToStay', (original) => {
        nativeOnChangeTipToStay = original as NativeFn;
        const wrapped: NativeFn = function (this: unknown, ...args: unknown[]) {
          const self = asRecord(this);
          const name = String(args[0] ?? '');
          if (self && name) {
            const staticTip = asRecord(self.staticTip2);
            if (
              staticTip
              && staticTip.destroyed !== true
              && String(staticTip.name ?? '') === name
            ) {
              if (staticTip[TIP_STAY_PREPROMOTED] === true || staticTip[TIP_STAY_ARMED] === true) {
                tipStayDebug(globalObject, 'OnChangeTipToStay:skip-prepromoted', name);
                return undefined;
              }
              const viewArr = Array.isArray(self.viewArr) ? self.viewArr as unknown[] : [];
              const stillInView = viewArr.some((raw) => {
                const tip = asRecord(raw);
                return Boolean(tip && String(tip.name ?? '') === name);
              });
              if (!stillInView) return undefined;
            }
          }
          return original.apply(this, args);
        };
        rebindStayStateListeners(manager, wrapped);
        return wrapped;
      });
    }

    managerProtoReady = true;
  }

  let promptLayerReady = false;
  function installPromptLayerStay(): void {
    if (promptLayerReady) return;
    const prompt = readPromptLayer(globalObject);
    if (!prompt || typeof prompt.stageTipClickHandler !== 'function') return;
    patcher.wrap(prompt, 'stageTipClickHandler', (original) => function (this: unknown, ...args: unknown[]) {
      const self = asRecord(this) ?? prompt;
      const tip = self ? asRecord(self.currentTip) : null;
      if (tip && isGeneralSkillTip(tip) && (tipCloseButtonVisible(tip) || tip[TIP_STAY_PREPROMOTED] === true)) {
        const mgr = readManager(globalObject);
        if (mgr) {
          const ok = promoteTipToStaticStay(globalObject, mgr, tip);
          const stats = tipStayStats(globalObject);
          stats.stageTipClickBlocked = Number(stats.stageTipClickBlocked ?? 0) + 1;
          recordLastClose(globalObject, 'stageTipClick:adopt', {
            name: String(tip.name ?? ''),
            ok,
            staticName: asRecord(mgr.staticTip2) ? String(asRecord(mgr.staticTip2)!.name ?? '') : '',
          });
          if (ok) {
            try {
              const stage = asRecord(globalObject.Laya?.stage);
              const Ev = asRecord(asRecord(globalObject.Laya)?.Event);
              if (stage && typeof stage.off === 'function') {
                (stage.off as NativeFn).call(stage, Ev?.CLICK ?? 'click', self, self.stageTipClickHandler);
                (stage.off as NativeFn).call(stage, Ev?.MOUSE_WHEEL ?? 'mousewheel', self, self.stageTipClickHandler);
              }
            } catch { /* ignore */ }
            return undefined;
          }
        }
      }
      return original.apply(this, args);
    });
    promptLayerReady = true;
  }

    function installTipProto(manager: UnknownRecord): void {
    const protos: UnknownRecord[] = [];
    const seen = new Set<object>();
    for (const tip of collectManagerTips(manager)) {
      if (typeof tip.onTimeComplete !== 'function') continue;
      const proto = readPrototype(globalObject, '', 'onTimeComplete', tip);
      if (proto && !seen.has(proto)) {
        seen.add(proto);
        protos.push(proto);
      }
    }
    for (const proto of protos) {
      if (tipProtosReady.has(proto)) continue;
      if (typeof proto.onTimeComplete !== 'function') continue;

      if (typeof proto.clickSprite === 'function') {
        patcher.wrap(proto, 'clickSprite', (original) => function (this: unknown, ...args: unknown[]) {
          const tip = asRecord(this);
          if (!tip || !isGeneralSkillTip(tip)) return original.apply(this, args);
          return withUserClosing(tip, userClosing, () => original.apply(this, args));
        });
      }

      // 原型层：同样先预提升再调原生
      patcher.wrap(proto, 'onTimeComplete', (original) => function (this: unknown, ...args: unknown[]) {
        const tip = asRecord(this);
        const mgr = readManager(globalObject);
        if (tip && mgr && isGeneralSkillTip(tip)) {
          promoteTipToStaticStay(globalObject, mgr, tip);
        }
        const result = original.apply(this, args);
        if (tip && mgr && isGeneralSkillTip(tip)) {
          enterStayWhenCloseAppeared(globalObject, mgr, tip, userClosing);
        }
        return result;
      });

      if (typeof proto.startCalTime === 'function') {
        patcher.wrap(proto, 'startCalTime', (original) => function (this: unknown, ...args: unknown[]) {
          const tip = asRecord(this);
          const mgr = readManager(globalObject);
          if (tip && mgr && isGeneralSkillTip(tip)) {
            armTipCloseAppearStay(globalObject, mgr, tip, userClosing);
            bindTimeAniOnComplete(globalObject, mgr, tip, userClosing);
          }
          return original.apply(this, args);
        });
      }

      if (typeof proto.ShowToolTip === 'function') {
        patcher.wrap(proto, 'ShowToolTip', (original) => function (this: unknown, ...args: unknown[]) {
          const result = original.apply(this, args);
          const tip = asRecord(this);
          const mgr = readManager(globalObject);
          if (tip && mgr && isGeneralSkillTip(tip)) {
            armTipCloseAppearStay(globalObject, mgr, tip, userClosing);
          }
          return result;
        });
      }

      tipProtosReady.add(proto);
    }
  }

  function scanAndEnterStay(manager: UnknownRecord): void {
    const tips = collectSkillTipsWide(globalObject, manager);
    for (const tip of tips) {
      armTipCloseAppearStay(globalObject, manager, tip, userClosing);
      if (tipCloseButtonVisible(tip) || tip[TIP_STAY_PREPROMOTED] === true) {
        enterStayWhenCloseAppeared(globalObject, manager, tip, userClosing);
      }
    }
  }

  function tick(): void {
    const manager = readManager(globalObject);
    installPromptLayerStay();
    if (manager) {
      installManagerProto(manager);
      installTipProto(manager);
      scanAndEnterStay(manager);
    }
  }

  const timer = globalObject.setInterval(tick, 50);
  tick();

  const dispose = () => {
    globalObject.clearInterval(timer);
    patcher.restoreAll();
    managerProtoReady = false;
    promptLayerReady = false;
    nativeCheckButtonMode = null;
    nativeOnChangeTipToStay = null;
    nativeOnStartStayToolTip = null;
    nativeClearTips2 = null;
    allowClearStayedSkillTip = false;
    cachedTipManager = null;
    if (bag.__xcGeneralSkillTipStayDispose === dispose) {
      delete bag.__xcGeneralSkillTipStayDispose;
    }
    if (bag.__xcGeneralSkillTipStayActive === true) {
      delete bag.__xcGeneralSkillTipStayActive;
    }
    tipStayDebug(globalObject, 'dispose', 'inactive');
  };
  bag.__xcGeneralSkillTipStayDispose = dispose;
  bag.__xcGeneralSkillTipStayActive = true;
  // 默认静默：清掉历史会话残留的刷屏开关（需要时用户再设 window.__xcTipStayDebug=true）
  try {
    if (bag.__xcTipStayDebug !== true) delete bag.__xcTipStayDebug;
    else { /* 显式 true 才保留 */ }
  } catch { /* ignore */ }
  // 若未显式打开，确保不是 truthy 残留
  if (bag.__xcTipStayDebug !== true) {
    try { bag.__xcTipStayDebug = false; } catch { /* ignore */ }
  }
  tipStayDebug(globalObject, 'install', 'active');
  return dispose;
}

export const generalSkillTipStayCoordinatorTesting = {
  dismissInterceptEnabled: false as const,
  hasReplacingHoverTip,
  collectVisibleGeneralTips,
  isVisibleGeneralTip,
  tipCloseButtonVisible,
  promoteStayEligibleTips,
  promoteTipToStaticStay,
  enterStayWhenCloseAppeared,
  shouldProtectFromTipsHide,
  timeAniCompleted,
  isTipManager,
  STAY_TIP_NAMES,
  TIP_STAY_PREPROMOTED,
};
