import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** 与 install 内 onCheckStaticTip2 包装一致：false 必须放行关闭。 */
function shouldPassOnCheckStaticTip2Close(allowArg: unknown, wouldBlockStay: boolean): boolean {
  if (allowArg === false) return true;
  return !wouldBlockStay;
}

describe('技能 tip 点关', () => {
  it('onCheckStaticTip2(false) 不因 stay 拦截', () => {
    assert.equal(shouldPassOnCheckStaticTip2Close(false, true), true);
    assert.equal(shouldPassOnCheckStaticTip2Close(true, true), false);
  });
});

/** 与 wrapTipsDismissMethod 一致：整表 TipsHide 不因技能 stay 拦截。 */
function managerDismissPassesThrough(methodName: string, keepStayOpen: boolean): boolean {
  if (methodName === 'TipsHide' || methodName === 'clearTips2') return true;
  if (methodName === 'HideTargetTips') return !keepStayOpen;
  return true;
}

describe('包裹道具 tip', () => {
  it('TipsHide / clearTips2 在技能停驻时仍走原生', () => {
    assert.equal(managerDismissPassesThrough('TipsHide', true), true);
    assert.equal(managerDismissPassesThrough('clearTips2', true), true);
  });

  it('HideTargetTips 只拦 GameGeneralToolTip 名', () => {
    assert.equal(managerDismissPassesThrough('HideTargetTips', true), false);
    assert.equal(managerDismissPassesThrough('HideTargetTips', false), true);
  });
});
