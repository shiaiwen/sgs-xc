import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { yieldGeneralSkillTipsToSeatUi } from '../src/runtime/general-skill-tip-state.ts';

describe('yieldGeneralSkillTipsToSeatUi', () => {
  it('不调用游戏 TipsHide', () => {
    let hideCalls = 0;
    const globalObject = {
      Laya: {
        ClassUtils: {
          getClass() {
            return {
              I() {
                return {
                  TipsHide() {
                    hideCalls += 1;
                  },
                  viewArr: [],
                };
              },
            };
          },
        },
      },
    } as never;
    yieldGeneralSkillTipsToSeatUi(globalObject);
    assert.equal(hideCalls, 0);
  });
});
