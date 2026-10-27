import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generalSkillTipStayCoordinatorTesting } from '../src/runtime/general-skill-tip-stay-coordinator.ts';

const { hasReplacingHoverTip, collectVisibleGeneralTips, isVisibleGeneralTip } =
  generalSkillTipStayCoordinatorTesting;

function tip(overrides: Record<string, unknown> = {}) {
  return {
    name: 'GameGeneralToolTip',
    destroyed: false,
    visible: true,
    alpha: 1,
    closeBtn: { destroyed: false, visible: false },
    ...overrides,
  };
}

function stayTip(overrides: Record<string, unknown> = {}) {
  return tip({ closeBtn: { destroyed: false, visible: true }, ...overrides });
}

describe('general-skill-tip-stay-coordinator', () => {
  it('替换 hover 未出 X 时视为替换未停', () => {
    const staticTip2 = stayTip();
    const currentTip = tip();
    assert.equal(hasReplacingHoverTip({ staticTip2, currentTip, viewArr: [] }), true);
  });

  it('collectVisibleGeneralTips 只收可见武将详情', () => {
    const hidden = tip({ visible: false });
    const visible = tip();
    const list = collectVisibleGeneralTips({ staticTip2: hidden, currentTip: visible, viewArr: [] });
    assert.equal(list.length, 1);
    assert.equal(list[0], visible);
  });

  it('isVisibleGeneralTip 排除透明', () => {
    assert.equal(isVisibleGeneralTip(tip({ alpha: 0 })), false);
    assert.equal(isVisibleGeneralTip(tip()), true);
  });
});
