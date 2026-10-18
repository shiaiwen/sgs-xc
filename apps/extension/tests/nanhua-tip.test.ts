import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildNanHuaEffectBlocks,
  nanHuaTipHtml,
  nanHuaTipOffset
} from '../src/features/extra-assist/nanhua-assist.ts';

const effects = [
  { type: 1, text: '你可以摸一张牌。' },
  { type: 2, text: '弃一张牌' },
  { type: 2, text: '摸两张牌' },
  { type: 2, text: '获得造成伤害的牌，然后再弃置一张牌' },
  { type: 3, text: '失去1点体力' }
];

test('短句并进同一条色条，长句单独一条', () => {
  const blocks = buildNanHuaEffectBlocks(effects);
  assert.match(blocks[1], /rgba\(0,83,255,0\.7\)/);
  assert.match(blocks[1], /第1类型/);
  assert.match(blocks[2], /rgba\(83,255,0,0\.7\)/);
  assert.match(blocks[2], /弃一张牌/);
  assert.match(blocks[2], /摸两张牌/);
  assert.match(blocks[2], /第2类型/);
  assert.equal(blocks[2].split('background-color').length - 1, 2);
  assert.match(blocks[3], /rgba\(255,100,0,0\.7\)/);
});

test('从当前时机的最低类型开始，更高类型一起出现', () => {
  const html = nanHuaTipHtml(buildNanHuaEffectBlocks(effects), 2);
  assert.doesNotMatch(html, /第1类型/);
  assert.match(html, /第2类型/);
  assert.match(html, /第3类型/);
  assert.match(html, /width:507px/);
});

test('说明位置随最低类型变化', () => {
  assert.equal(nanHuaTipOffset(1), -70);
  assert.equal(nanHuaTipOffset(2), 8);
  assert.equal(nanHuaTipOffset(3), 116);
});
