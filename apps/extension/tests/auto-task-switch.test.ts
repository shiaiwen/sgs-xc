import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createConfigStore } from '../src/config/config-store.ts';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';
import { installAutoTaskController } from '../src/features/auto-task/auto-task-controller.ts';
import { AUTO_TASK_SKIP_SETTINGS } from '../src/features/auto-task/auto-task-settings.ts';

const noopLocator = {
  dispatcher: () => ({}),
  manager: () => null,
  window: () => null,
  gameScene: () => null,
  createInstance: () => null,
  obfuscatedMethodName: () => null
} as never;

function setup() {
  const config = getDefaultConfig();
  config['autoTask.enabled'] = false;
  // 关着时全是跳过；打开总开关应变成全要领。
  AUTO_TASK_SKIP_SETTINGS.forEach(({ key }) => { config[key] = true; });
  const store = createConfigStore(
    { read: () => structuredClone(config), write: () => {}, clear: () => {} },
    undefined
  );
  const controller = installAutoTaskController(store, createGameEventBus(), {
    locator: noopLocator,
    globalObject: {} as never
  });
  return { store, controller };
}

/** 总开关控制领取项：开=全要领，关=全不领。 */
test('自动领取开关联动六个领取项', () => {
  const { store, controller } = setup();
  try {
    const skipStates = () => AUTO_TASK_SKIP_SETTINGS.map(({ key }) => store.get(key));
    assert.deepEqual(skipStates(), [true, true, true, true, true, true]);

    store.set('autoTask.enabled', true);
    assert.deepEqual(skipStates(), [false, false, false, false, false, false], '打开总开关要全要领');

    store.set('autoTask.enabled', false);
    assert.deepEqual(skipStates(), [true, true, true, true, true, true], '关闭总开关要全不领');
  } finally {
    controller.dispose();
  }
});
