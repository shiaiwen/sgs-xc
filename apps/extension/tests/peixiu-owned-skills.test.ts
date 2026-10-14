import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendRewardIds, defaultMapCityRewardId, rewardIdsCollectedSince } from '../src/features/extra-assist/peixiu-resources.ts';

test('只获得临邛时，益州地图仍带上当前所在的益州', () => {
  const lookup = {
    getReward(id: number) {
      if (id === 8) return { rewardId: 8, name: '益州', description: '' };
      if (id === 9) return { rewardId: 9, name: '临邛', description: '' };
      return null;
    },
    findByName(name: string) {
      return name === '益州' ? 8 : 0;
    }
  };
  assert.equal(defaultMapCityRewardId({
    id: 8,
    name: '益州',
    rewards: [{ rewardId: 9, cell: 4 }]
  }, lookup), 8);
  assert.equal(defaultMapCityRewardId({ id: 3, name: '司州', rewards: [{ rewardId: 9, cell: 4 }] }, lookup), 0);
});

test('走到琅琊和徐州时，彭城作为当前城补上，不会把同图所有城都算上', () => {
  const lookup = {
    getReward(id: number) {
      const names: Record<number, string> = { 1: '琅琊', 2: '徐州', 3: '彭城' };
      return names[id] ? { rewardId: id, name: names[id], description: '' } : null;
    },
    findByName(name: string) {
      return name === '彭城' ? 3 : 0;
    }
  };
  assert.equal(defaultMapCityRewardId({
    name: '彭城',
    rewards: [
      { rewardId: 1, cell: 4 },
      { rewardId: 2, cell: 8 },
      { rewardId: 1, cell: 26, type: 26 },
      { rewardId: 2, cell: 26, type: 26 },
      { rewardId: 3, cell: 26, type: 26 }
    ]
  }, lookup), 3);
});

test('跑完一张图后，下一张图的城接在原列表后面', () => {
  const afterFirst = appendRewardIds([], [8, 9]);
  const afterSecond = appendRewardIds(afterFirst, [3, 9]);
  assert.deepEqual(afterSecond, [8, 9, 3]);
});

test('地图刚展开时已画上的格子不算已获得技能', () => {
  const opened = [1, 2, 3];
  const ids = rewardIdsCollectedSince(opened, new Set(opened), (cell) => cell + 100);
  assert.deepEqual(ids, []);
});

test('展开时所在的城默认算完成，下一回合仍保留', () => {
  const rewardAt = (cell: number) => cell + 100;
  const opened = [1, 2, 3];
  const ids = rewardIdsCollectedSince(opened, new Set(opened), rewardAt, [1]);
  assert.deepEqual(ids, [101]);
});

test('本回合新走到的格子才计入技能，下一回合以当时格子为基准后清空', () => {
  const rewardAt = (cell: number) => cell + 100;
  const afterStep = rewardIdsCollectedSince([1, 2, 4], new Set([1, 2]), rewardAt);
  assert.deepEqual(afterStep, [104]);
  const nextTurn = rewardIdsCollectedSince([1, 2, 4], new Set([1, 2, 4]), rewardAt);
  assert.deepEqual(nextTurn, []);
});
