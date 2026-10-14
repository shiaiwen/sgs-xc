import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installMicroClientFocusBridge } from '../src/runtime/micro-client-focus.ts';

type BridgeWindow = Parameters<typeof installMicroClientFocusBridge>[0];
type Listener = (event: { target: unknown }) => void;

/** 只实现用到的那点 DOM：注册监听、派发事件。 */
function createFakeWindow(options: { electron?: boolean } = {}) {
  const listeners = new Map<string, Set<Listener>>();
  const calls: string[] = [];
  const document = {
    addEventListener(type: string, listener: Listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener(type: string, listener: Listener) {
      listeners.get(type)?.delete(listener);
    }
  };
  const globalObject = {
    document,
    ...(options.electron === false ? {} : { electron: { focusWebview: () => calls.push('focus') } })
  } as unknown as BridgeWindow;
  const dispatch = (type: string, target: unknown) => {
    [...(listeners.get(type) ?? [])].forEach((listener) => listener({ target }));
  };
  const count = () => [...listeners.values()].reduce((total, set) => total + set.size, 0);
  return { globalObject, calls, dispatch, count };
}

test('输入框拿到焦点时请外壳把键盘焦点交回 webview', () => {
  const fake = createFakeWindow();
  const dispose = installMicroClientFocusBridge(fake.globalObject);
  fake.dispatch('focusin', { tagName: 'INPUT', isContentEditable: false });
  fake.dispatch('pointerdown', { tagName: 'TEXTAREA', isContentEditable: false });
  assert.deepEqual(fake.calls, ['focus', 'focus']);
  dispose();
});

test('画布和普通元素不触发，点了也不会误抢焦点', () => {
  const fake = createFakeWindow();
  const dispose = installMicroClientFocusBridge(fake.globalObject);
  fake.dispatch('pointerdown', { tagName: 'CANVAS', isContentEditable: false });
  fake.dispatch('focusin', { tagName: 'DIV', isContentEditable: false });
  fake.dispatch('pointerdown', { tagName: 'DIV', isContentEditable: true });
  assert.deepEqual(fake.calls, ['focus']);
  dispose();
});

test('非微端环境不装监听，直接空转', () => {
  const fake = createFakeWindow({ electron: false });
  const dispose = installMicroClientFocusBridge(fake.globalObject);
  assert.equal(fake.count(), 0);
  assert.deepEqual(fake.calls, []);
  assert.equal(typeof dispose, 'function');
  dispose();
});

test('dispose 之后不再回调', () => {
  const fake = createFakeWindow();
  const dispose = installMicroClientFocusBridge(fake.globalObject);
  fake.dispatch('focusin', { tagName: 'INPUT', isContentEditable: false });
  dispose();
  fake.dispatch('focusin', { tagName: 'INPUT', isContentEditable: false });
  assert.deepEqual(fake.calls, ['focus']);
  assert.equal(fake.count(), 0);
});
