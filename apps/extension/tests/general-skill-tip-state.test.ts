import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { yieldGeneralSkillTipsToSeatUi } from '../src/runtime/general-skill-tip-state.ts';

describe('yieldGeneralSkillTipsToSeatUi', () => {
  it('有管理器时调用原生 TipsHide', () => {
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
    assert.equal(hideCalls, 1);
  });
});
