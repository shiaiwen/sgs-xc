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
