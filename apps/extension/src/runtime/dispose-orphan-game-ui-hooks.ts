/**
 * 卸载历史 tip dismiss / popup-protector 残留 wrap。
 * 不要调用 __xcGeneralSkillTipStayDispose：那会卸掉正在使用的技能 tip 停驻。
 */

import { createLayaObjectLocator, type LayaRuntimeWindow } from '../adapters/laya-object-locator.ts';

type UnknownRecord = Record<string, unknown>;

const XC_METHOD_WRAP = Symbol.for('sgsxc.methodPatch.wrap');
const XC_METHOD_ORIGINAL = Symbol.for('sgsxc.methodPatch.original');

const TIP_MANAGER_METHODS = [
  // tip-stay v6 占用：TipsHide(预提升)/clearTips2(守卫)/onCheckStaticTip2(放行旗)/OnChangeTipToStay
  // 勿剥，否则进局 dispose→缝隙期会卸掉停驻守卫
  'HideTargetTips',
  'checkButtonMode',
] as const;

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function unwrapOwnMethod(target: UnknownRecord, name: string): boolean {
  const current = target[name];
  if (typeof current !== 'function') return false;
  const tagged = current as UnknownRecord;
  if (!tagged[XC_METHOD_WRAP]) return false;
  const original = tagged[XC_METHOD_ORIGINAL];
  if (typeof original !== 'function') return false;
  try {
    target[name] = original;
    return true;
  } catch {
    return false;
  }
}

function findTipManager(globalObject: LayaRuntimeWindow): UnknownRecord | null {
  const locator = createLayaObjectLocator(globalObject);
  try {
    const fromPred = locator.findManagerByPredicate((candidate) => {
      const rec = asRecord(candidate);
      return Boolean(
        rec
        && typeof rec.TipsHide === 'function'
        && Array.isArray(rec.viewArr)
      );
    });
    if (fromPred) return fromPred;
  } catch {
    // ignore
  }
  return null;
}

function unwrapTipManagerChain(manager: UnknownRecord): number {
  // tip-stay 存活时不要动 tip manager 方法链
  try {
    if ((globalThis as UnknownRecord).__xcGeneralSkillTipStayActive === true) return 0;
  } catch { /* ignore */ }
  let n = 0;
  const targets: UnknownRecord[] = [manager];
  let proto = asRecord(Object.getPrototypeOf(manager));
  const seen = new Set<object>();
  while (proto && !seen.has(proto)) {
    seen.add(proto);
    targets.push(proto);
    proto = asRecord(Object.getPrototypeOf(proto));
  }
  for (const target of targets) {
    for (const name of TIP_MANAGER_METHODS) {
      // unwrap possibly nested wraps
      for (let i = 0; i < 8; i += 1) {
        if (!unwrapOwnMethod(target, name)) break;
        n += 1;
      }
    }
  }
  return n;
}

function restoreUserInfoCloseOriginals(win: UnknownRecord | null): number {
  if (!win) return 0;
  const methods = ['Close', 'close', 'CloseWin', 'Hide', 'hide', 'laterClose', 'removeSelf', 'destroy'] as const;
  const originals = asRecord(win.__xcUserInfoCloseOriginals);
  if (!originals) return 0;
  let n = 0;
  for (const method of methods) {
    const original = originals[method];
    if (typeof original !== 'function') continue;
    try {
      win[method] = original;
      n += 1;
    } catch {
      // ignore
    }
  }
  try {
    delete win.__xcUserInfoCloseOriginals;
    delete win.__xcUserInfoCloseGuarded;
  } catch {
    // ignore
  }
  return n;
}

/** 调用旧 dispose，并尽量剥掉 tip 管理器上残留的 method-patch wrap。 */
export function disposeOrphanTipStayHooks(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): number {
  const bag = globalObject as UnknownRecord;
  let restored = 0;
  for (const key of [
    // 勿 dispose tip-stay：install 后/进局再调用会把 OnChange/OTC wrap 全部 restore 掉
    '__xcGameNativePopupProtectorDispose',
    '__xcUserInfoOpenWindowArmDispose',
  ] as const) {
    const dispose = bag[key];
    if (typeof dispose === 'function') {
      try {
        (dispose as () => void)();
        restored += 1;
      } catch {
        // ignore
      }
      try {
        delete bag[key];
      } catch {
        // ignore
      }
    }
  }
  try {
    delete bag.__xcUserInfoDismissGuardUntil;
    delete bag.__xcSeatMenuTipsHoldUntil;
    delete bag.__xcAllowHideUserOptMenu;
  } catch {
    // ignore
  }
  const manager = findTipManager(globalObject);
  if (manager) restored += unwrapTipManagerChain(manager);
  // 还原 UserInfo 实例上可能残留的 Close/Hide 吞掉包装
  try {
    const cached = asRecord(bag.__xcCachedUserInfoWindow);
    restored += restoreUserInfoCloseOriginals(cached);
  } catch {
    // ignore
  }
  try {
    (globalObject as UnknownRecord).__xcDisposeOrphanTipStayHooks = () => {
      disposeOrphanTipStayHooks(globalObject);
    };
  } catch {
    // ignore
  }
  return restored;
}
