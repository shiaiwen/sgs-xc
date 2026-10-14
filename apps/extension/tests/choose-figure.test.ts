import assert from 'node:assert/strict';
import {
  figureByClientOrder,
  figureConflicts,
  isIdentityFigure,
  resolveSeatFigure
} from '../src/features/identity-drill/choose-figure.ts';
import { isChooseFigure } from '../src/features/identity-drill/choose-figure-controller.ts';

assert.equal(isChooseFigure({ IsChooseFigure: true }), true);
assert.equal(isChooseFigure({ IsChooseFigure: 1 }), true);
assert.equal(isChooseFigure({ IsChooseFigure: '1' }), true);
assert.equal(isChooseFigure({ IsChooseFigure: false }), false);
assert.equal(isChooseFigure(null), false);

const ids = ['11', '22', '33', '44', '55', '66', '77', '88'];
assert.equal(figureByClientOrder(ids, '11'), 1);
assert.equal(figureByClientOrder(ids, '44'), 4);
assert.equal(figureByClientOrder(ids, '55'), 3);
assert.equal(figureByClientOrder(ids.slice(0, 7), '11'), 0);

// 自己的座位：服务器给的身份就是准的，按房间顺序算出来的忠臣不能盖掉主公。
assert.deepEqual(resolveSeatFigure({ isSelf: true, byAccount: 1, byRoomOrder: 2 }), {
  figure: 1, source: '账', writable: false
});
assert.deepEqual(resolveSeatFigure({ isSelf: true, byRoomOrder: 2 }), {
  figure: 2, source: '序', writable: false
});
assert.deepEqual(resolveSeatFigure({ isSelf: true }), {
  figure: 0, source: '无', writable: false
});

// 别人的座位按可信度取值：账号锁定 → 昵称锁定 → 座位锁定 → 房间顺序 → 画面座位号。
assert.deepEqual(resolveSeatFigure({
  isSelf: false, byAccount: 3, byName: 4, bySeat: 2, byRoomOrder: 1, bySeatIndex: 1
}), { figure: 3, source: '账', writable: true });
assert.deepEqual(resolveSeatFigure({
  isSelf: false, byName: 4, bySeat: 2, byRoomOrder: 1, bySeatIndex: 1
}), { figure: 4, source: '名', writable: true });
assert.deepEqual(resolveSeatFigure({
  isSelf: false, bySeat: 2, byRoomOrder: 1, bySeatIndex: 1
}), { figure: 2, source: '座', writable: true });
assert.deepEqual(resolveSeatFigure({
  isSelf: false, byRoomOrder: 1, bySeatIndex: 3
}), { figure: 1, source: '序', writable: true });
assert.deepEqual(resolveSeatFigure({ isSelf: false, bySeatIndex: 3 }), {
  figure: 3, source: '位', writable: true
});

// 空值、0、小数都不算身份，继续往下一条找。
assert.deepEqual(resolveSeatFigure({
  isSelf: false, byAccount: 0, byName: Number.NaN, bySeat: 2.5, byRoomOrder: 4
}), { figure: 4, source: '序', writable: true });
assert.deepEqual(resolveSeatFigure({ isSelf: false }), {
  figure: 0, source: '无', writable: false
});

// 只有 1 到 4 算身份：0、5 和画面上的其它编号都不能拿来跟自己的身份比。
assert.equal(isIdentityFigure(1), true);
assert.equal(isIdentityFigure(4), true);
assert.equal(isIdentityFigure(0), false);
assert.equal(isIdentityFigure(5), false);
assert.equal(isIdentityFigure(undefined), false);
assert.equal(isIdentityFigure('3'), true);

// 校验用：只有两边都是有效身份且不一样才算打架，游戏还没给身份时不算。
assert.equal(figureConflicts(1, 2), true);
assert.equal(figureConflicts(2, 2), false);
assert.equal(figureConflicts(1, 0), false);
assert.equal(figureConflicts(0, 1), false);
assert.equal(figureConflicts(undefined, 1), false);
assert.equal(figureConflicts(1, '1'), false);

console.log('choose-figure ok');
