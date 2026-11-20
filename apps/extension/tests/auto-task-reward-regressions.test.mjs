import assert from 'node:assert/strict';
import test from 'node:test';
import { createAutoTaskRunner } from '../src/features/auto-task/auto-task-runner.ts';
import { createAutoTaskClaims } from '../src/features/auto-task/auto-task-claims.ts';
import { claimTask, isTaskExcluded, taskClaimState } from '../src/features/auto-task/auto-task-rules.ts';
import { createMethodPatcher } from '../src/runtime/method-patch.ts';

function emitter(values = {}) {
  const listeners = new Map();
  return Object.assign(values, {
    on(event, caller, fn) {
      const bucket = listeners.get(event) ?? [];
      bucket.push({ caller, fn });
      listeners.set(event, bucket);
    },
    off(event, caller, fn) {
      listeners.set(event, (listeners.get(event) ?? []).filter(item => item.caller !== caller || item.fn !== fn));
    },
    emit(event, data) {
      for (const item of [...(listeners.get(event) ?? [])]) item.fn.call(item.caller, data);
    },
    listenerCount() { return [...listeners.values()].reduce((sum, rows) => sum + rows.length, 0); }
  });
}

function harness(managers, quest = null, windows = {}) {
  let now = 100_000;
  let account = 'account-a';
  const tasks = { disposed: false, later(fn, ms) { if (ms <= 1200) queueMicrotask(fn); } };
  const runner = createAutoTaskRunner({
    locator: {
      manager: name => managers[name] ?? null,
      findManagerByPredicate: check => quest && check(quest) ? quest : null,
      obfuscatedMethodName: () => null
    },
    windows: { get: () => null, release() {}, ...windows },
    claims: createAutoTaskClaims(undefined, () => account, () => now),
    tasks, enabled: () => !tasks.disposed,
    options: () => ({ skipTavern: false, skipMail: true, skipDailyGeneralBag: true,
      skipSignTrialCard: true, skipDiJiaQuan: false, skipHuanLeDou: true,
      skipFreeBless: true, skipFreeTreasureFlip: true }),
    configData: () => null,
    account: () => account
  });
  return { runner, tasks, advance() { now += 20_000; }, switchAccount() { account = 'account-b'; } };
}

async function flush() { for (let i = 0; i < 35; i++) await Promise.resolve(); }

for (const first of ['free', 'paid']) {
  test(`new codex waits for both claim lists (${first} arrives first)`, async () => {
    let views = 0;
    let claims = 0;
    const activity = emitter({ NewJDLevel: 1, NewJDHaveRewardList: [], NewJDHaveRewardList_bp: [],
      HasNewJDRewardRed: true, NEW_JD_INFO_SUC: 'codex-info', NEW_JD_REWARD_REP: 'codex-reward',
      SendGetNewJDInfoReq() {}, SendGetNewJDRewardReq() { claims++; } });
    const h = harness({ ActivityManager: activity }, null, {
      get(name) {
        if (name !== 'NewJunDianViewCtrl') return null;
        views++;
        return { createSubView: () => ({ currentScore: 100,
          curScoreAwards: [{ Id: 7, Point: 10, ItemId: 100, FfItemId: 101 }] }) };
      }
    });
    h.runner.runPass();
    const field = first === 'free' ? 'NewJDHaveRewardList' : 'NewJDHaveRewardList_bp';
    activity[field] = [7];
    activity.emit('codex-info');
    await flush();
    assert.equal(views, 0);
    activity[first === 'free' ? 'NewJDHaveRewardList_bp' : 'NewJDHaveRewardList'] = [7];
    activity.emit('codex-info');
    await flush();
    assert.equal(views, 1);
    assert.equal(claims, 0, 'already claimed awards must not be requested again');
    assert.equal(activity.listenerCount(), 0);
  });
}

test('old privilege daily silver skips inactive cards and still claims active cards', async () => {
  let active = false;
  const requests = [];
  let checked = 0;
  const welfare = {
    GetCardDataByType: type => ({ bActive: active && type === 2, bReward: false }),
    CanShowPrivilegeDaliyReward() { checked++; return true; },
    PrivilegeCardDaliyRewardReq(type) { requests.push(type); }
  };
  const h = harness({ WelfareManger: welfare });
  h.runner.runPass();
  await flush();
  assert.equal(checked, 0);
  assert.deepEqual(requests, []);
  active = true;
  h.runner.runPass();
  await flush();
  assert.deepEqual(requests, [2]);
});

const context = { skipTavern: false, skipDiJiaQuan: false, skipHuanLeDou: false,
  taskIds: null, newFuliTaskIds: null, returnUnlockTaskIds: null,
  goodsName: () => '', goodsHasPropItem: () => false };

test('task 200041 waits for predecessor 200040 to be claimed', () => {
  const task = { id: 200041, CanAward: true, baseVo: { prevTask: 200040 } };
  let previous = { HasAward: false };
  let requests = 0;
  const access = { manager: {}, has: () => true, call(name, id) {
    if (name === 'GetServerTaskDataByTaskID') return id === 200041 ? task : previous;
    if (name === 'GetNoGetTaskDataByTaskID') return null;
    if (name === 'RequestTaskAward') requests++;
  } };
  assert.equal(claimTask(access, 200041, task, context), false);
  assert.equal(requests, 0);
  previous = { HasAward: true };
  claimTask(access, 200041, task, context);
  assert.equal(requests, 1);
});

for (const protocol of ['decodeUserQuestOpRep', 'SmsgTaskFailed']) {
  test(`${protocol}: rejected state stops retries and progress changes permit retry`, async () => {
    const proxy = emitter();
    const task = { id: 200041, CanAward: true, IsFromServer: true, Status: 2,
      condition_data: [{ condition_id: 0, condition_cnt: 1 }],
      baseVo: { prevTask: 200040, TaskRewardItem: [{ ItemID: 100 }] } };
    const previous = { id: 200040, HasAward: true };
    const data = { 200041: task, 200040: previous };
    let requests = 0;
    const quest = {
      UpTaskState() {}, clientQusetInfoRep() {}, getTaskListFromServer() {},
      allTasks: { _maps: data }, GetServerTaskDataByTaskID: id => data[id],
      RequestTaskAward(id) {
        requests++;
        const payload = protocol === 'decodeUserQuestOpRep'
          ? { Protocol: { Data: { ProtoObj: { quest_id: id, result: 202 } } } }
          : { Protocol: { TaskID: id, ErrorCode: 5 } };
        proxy.emit(protocol, payload);
      }
    };
    const h = harness({ ServerProxy: proxy }, quest);
    h.runner.runClaimForSkipKey('autoTask.skipTavern');
    await flush();
    assert.equal(requests, 1);
    assert.equal(proxy.listenerCount(), 0);
    h.advance();
    h.runner.runClaimForSkipKey('autoTask.skipTavern');
    await flush();
    assert.equal(requests, 1);
    const before = taskClaimState(task);
    task.condition_data[0].condition_cnt++;
    assert.notEqual(taskClaimState(task), before);
    h.advance();
    h.runner.runClaimForSkipKey('autoTask.skipTavern');
    await flush();
    assert.equal(requests, 2);
    h.advance();
    h.switchAccount();
    h.runner.runClaimForSkipKey('autoTask.skipTavern');
    await flush();
    assert.equal(requests, 3, 'rejection must not carry over to another account');
    assert.equal(proxy.listenerCount(), 0);
  });
}

test('established excluded task ids are skipped even when marked claimable', () => {
  let requests = 0;
  for (const id of [97, 98, 126, 127]) {
    const task = { id, CanAward: true };
    const access = { manager: {}, has: () => true, call(name, taskId) {
      if (name === 'GetServerTaskDataByTaskID' || name === 'GetAllTaskDataByTaskID') return taskId === id ? task : null;
      if (name === 'RequestTaskAward' || name === 'RequestAcceptTask') requests++;
    } };
    assert.equal(isTaskExcluded(task, context, id), true);
    assert.equal(claimTask(access, id, task, context), false);
  }
  assert.equal(requests, 0);
});

test('ids without an established exclusion remain eligible for the claim path', () => {
  for (const id of [169869, 200041, 900041]) {
    assert.equal(isTaskExcluded({ id, CanAward: true }, context, id), false);
  }
});

test('auto-claim suppresses the 107014 popup for its own quest only', async () => {
  const patcher = createMethodPatcher();
  const calls = [];
  const dispatcher = {
    ShowProtocolError(protocolId, code, suffix) { calls.push([protocolId, code, suffix]); }
  };
  const proxy = emitter();
  const task = { id: 200041, CanAward: true, IsFromServer: true, Status: 2,
    condition_data: [{ condition_id: 0, condition_cnt: 1 }],
    baseVo: { prevTask: 200040, TaskRewardItem: [{ ItemID: 100 }] } };
  const previous = { id: 200040, HasAward: true };
  const data = { 200041: task, 200040: previous };
  const quest = {
    UpTaskState() {}, clientQusetInfoRep() {}, getTaskListFromServer() {},
    allTasks: { _maps: data }, GetServerTaskDataByTaskID: id => data[id],
    RequestTaskAward() {}
  };
  const runner = createAutoTaskRunner({
    locator: {
      manager: name => ({ ServerProxy: proxy, TaskManager: quest })[name] ?? null,
      findManagerByPredicate: () => null,
      obfuscatedMethodName: () => null,
      dispatcher: () => dispatcher
    },
    windows: { get: () => null, release() {}, opened: () => null, closeOpened() {} },
    claims: createAutoTaskClaims(undefined, () => 'account-a', () => Date.now()),
    tasks: { disposed: false, later(fn, ms) { if (ms <= 1200) queueMicrotask(fn); } },
    patcher,
    enabled: () => true,
    options: () => ({ skipTavern: false, skipMail: true, skipDailyGeneralBag: true,
      skipSignTrialCard: true, skipDiJiaQuan: false, skipHuanLeDou: true,
      skipFreeBless: true, skipFreeTreasureFlip: true }),
    configData: () => null,
    account: () => 'account-a'
  });
  runner.runClaimForSkipKey('autoTask.skipTavern');
  await flush();
  dispatcher.ShowProtocolError(107014, 203, '200041');
  dispatcher.ShowProtocolError(107014, 203, '999999');
  dispatcher.ShowProtocolError(12345, 203, '200041');
  assert.deepEqual(calls, [[107014, 203, '999999'], [12345, 203, '200041']]);
  patcher.restoreAll();
  dispatcher.ShowProtocolError(107014, 203, '200041');
  assert.deepEqual(calls, [[107014, 203, '999999'], [12345, 203, '200041'], [107014, 203, '200041']]);
});

