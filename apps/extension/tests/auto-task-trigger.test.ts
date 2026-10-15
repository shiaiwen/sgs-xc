import assert from 'node:assert/strict';
import { describe, test } from 'node:test';
import { translateGameMessages } from '../src/adapters/game-message-adapter.ts';
import { createConfigStore } from '../src/config/config-store.ts';
import { getDefaultConfig } from '../src/config/config-schema.ts';
import { installAutoTaskController } from '../src/features/auto-task/auto-task-controller.ts';
import { beijingDayIndex } from '../src/features/auto-task/auto-task-claims.ts';
import { createGameEventBus } from '../src/runtime/game-event-bus.ts';

const LAST_TASK_DATE_KEY = 'XC::lastTaskDate';

const noopLocator = {
  dispatcher: () => ({}),
  manager: () => null,
  window: () => null,
  gameScene: () => null,
  createInstance: () => null,
  obfuscatedMethodName: () => null
} as never;

function memoryStorage(seed?: number) {
  const data = new Map<string, string>();
  if (seed !== undefined) data.set(LAST_TASK_DATE_KEY, JSON.stringify(seed));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    }
  };
}

function accountHost(profile: { self: Record<string, unknown> | null }) {
  return {
    Laya: {
      ClassUtils: {
        getClass(name: string) {
          if (name !== 'UserData') return undefined;
          return { Self: profile.self };
        }
      }
    }
  } as never;
}

function install(options: {
  enabled?: boolean;
  now?: () => number;
  storage?: ReturnType<typeof memoryStorage>;
  profile?: { self: Record<string, unknown> | null };
  events?: ReturnType<typeof createGameEventBus>;
} = {}) {
  const config = getDefaultConfig();
  config['autoTask.enabled'] = options.enabled === true;
  const store = createConfigStore(
    { read: () => structuredClone(config), write: () => {}, clear: () => {} },
    undefined
  );
  const events = options.events ?? createGameEventBus();
  const profile = options.profile ?? { self: null };
  const controller = installAutoTaskController(store, events, {
    locator: noopLocator,
    globalObject: accountHost(profile),
    storage: options.storage,
    now: options.now
  });
  const scheduled: string[] = [];
  controller.subscribe((status) => {
    if (status.message.startsWith('已调度')) scheduled.push(status.lastReason);
  });
  return { store, events, controller, scheduled, profile };
}

describe('自动领取触发时机', { concurrency: 1 }, () => {

test('心跳协议翻译成心跳事件', () => {
  assert.deepEqual(
    translateGameMessages([{ ClassName: 'MsgHeartAliveRep', ServerTime: 1 }]),
    [{ type: 'heart-alive' }]
  );
});

test('同一天心跳不领，日期变了才领并写入日期', () => {
  let current = 1_700_000_000_000;
  const storage = memoryStorage(beijingDayIndex(current));
  const { events, controller } = install({
    enabled: true,
    now: () => current,
    storage
  });
  try {
    events.publish({ type: 'heart-alive' });
    assert.equal(controller.getStatus().lastReason, '', '同一天不调度');
    assert.equal(storage.getItem(LAST_TASK_DATE_KEY), JSON.stringify(beijingDayIndex(current)));

    current += 24 * 60 * 60 * 1000;
    events.publish({ type: 'heart-alive' });
    assert.equal(controller.getStatus().lastReason, 'heartbeat');
    assert.equal(controller.getStatus().message, '已调度（heartbeat）');
    assert.equal(storage.getItem(LAST_TASK_DATE_KEY), JSON.stringify(beijingDayIndex(current)));

    events.publish({ type: 'heart-alive' });
    assert.equal(controller.getStatus().message, '已调度（heartbeat）');
  } finally {
    controller.dispose();
  }
});

test('总开关关着时心跳跨天只记日期不领', () => {
  let current = 1_700_000_000_000;
  const storage = memoryStorage(beijingDayIndex(current));
  const { events, controller, scheduled } = install({
    enabled: false,
    now: () => current,
    storage
  });
  try {
    current += 24 * 60 * 60 * 1000;
    events.publish({ type: 'heart-alive' });
    assert.deepEqual(scheduled, []);
    assert.equal(controller.getStatus().phase, 'idle');
    assert.equal(storage.getItem(LAST_TASK_DATE_KEY), JSON.stringify(beijingDayIndex(current)));
  } finally {
    controller.dispose();
  }
});

test('账号资料到达才登录领取，同一账号不重复，换号再领', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const profile = { self: null as Record<string, unknown> | null };
  const { controller, scheduled } = install({ enabled: true, profile });
  try {
    t.mock.timers.tick(1000);
    assert.deepEqual(scheduled, [], '还没有账号时不领');

    profile.self = { clientId: 1001 };
    t.mock.timers.tick(1000);
    assert.deepEqual(scheduled, [], '只有编号没有昵称时不算资料到了');

    profile.self = { clientId: 1001, nickname: '甲' };
    t.mock.timers.tick(1000);
    assert.deepEqual(scheduled, ['login']);

    profile.self = { ClientId: 1001, NickName: '甲' };
    t.mock.timers.tick(1000);
    assert.deepEqual(scheduled, ['login'], '同一账号再到达不重复领');

    profile.self = { clientId: '1002', nickname: '乙' };
    t.mock.timers.tick(1000);
    assert.deepEqual(scheduled, ['login', 'login'], '换号再领一轮');
  } finally {
    controller.dispose();
  }
});

test('启动时账号已经在，只领一轮', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const profile = { self: { clientId: '1001', nickname: '甲' } as Record<string, unknown> | null };
  const { controller, scheduled } = install({ enabled: true, profile });
  try {
    assert.equal(controller.getStatus().lastReason, 'login');
    assert.equal(controller.getStatus().message, '已调度（login）');
    t.mock.timers.tick(1000);
    assert.deepEqual(scheduled, [], '之后的检查不再领登录');
  } finally {
    controller.dispose();
  }
});

test('总开关关着时账号到达不领', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const profile = { self: null as Record<string, unknown> | null };
  const { store, controller, scheduled } = install({ enabled: false, profile });
  try {
    profile.self = { clientId: '1001', nickname: '甲' };
    t.mock.timers.tick(1000);
    assert.deepEqual(scheduled, []);
    store.set('autoTask.enabled', true);
    assert.equal(scheduled.includes('login'), false);
    assert.equal(scheduled.includes('switch'), true);
    t.mock.timers.tick(1000);
    assert.equal(scheduled.filter((reason) => reason === 'login').length, 0, '已经见过的账号不再补一轮登录');
  } finally {
    controller.dispose();
  }
});

});
