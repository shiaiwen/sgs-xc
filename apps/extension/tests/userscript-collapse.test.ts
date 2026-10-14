import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collapseUserscriptBody } from '../vite.userscript.config.ts';

const HEADER = '// ==UserScript==\n// @name 测试\n// ==/UserScript==\n';

function bodyOf(source: string): string {
  return collapseUserscriptBody(`${HEADER}${source}`);
}

/** 取折叠后正文里以 mark 开头的那段，用于直接求值验证语义。 */
function evalFrom(collapsed: string, mark: string): unknown {
  const code = collapsed.slice(collapsed.indexOf(mark));
  return eval(code);
}

test('压缩器写成模板字符串的换行被保留，split 不会退化成按字拆分', () => {
  // 压缩器把 '\n' 输出成含真实换行的模板字符串，折叠时吞掉换行就成了 split('')。
  const collapsed = bodyOf('String(`200铜币\n普通卡牌自选`).split(`\n`).filter(Boolean)');
  assert.ok(!collapsed.includes('split(``)'), '模板字符串里的换行被吞了');
  assert.deepEqual(evalFrom(collapsed, 'String('), ['200铜币', '普通卡牌自选']);
});

test('压成一行后奖励文案仍是两段，不按字拆', () => {
  const collapsed = bodyOf('const text = `200铜币\n普通卡牌自选`;');
  const value = /const text = (`.*?`);/.exec(collapsed)?.[1];
  assert.ok(value, `模板没匹配到：${collapsed}`);
  assert.equal(eval(value), '200铜币\n普通卡牌自选');
  assert.equal(String(eval(value)).split('\n').length, 2);
});

test('代码里的换行继续收掉，程序保持一行', () => {
  const collapsed = bodyOf('function a() {\n  return 1;\n}\nfunction b() {\n  return 2;\n}');
  assert.match(collapsed, /function a\(\) \{ *return 1;\}function b\(\) \{ *return 2;\}\n$/);
  assert.equal(collapsed.split('\n').filter((line) => line && !line.startsWith('//')).length, 1);
});

test('行注释后面的换行必须留着，否则会把下一行注释掉', () => {
  const collapsed = bodyOf('const a = 1; // 说明\nconst b = 2;');
  assert.match(collapsed, /const a = 1; \/\/ 说明\nconst b = 2;/);
});

test('${} 里嵌套的模板字符串同样保住换行', () => {
  const collapsed = bodyOf('const joined = `前缀${`甲\n乙`}后缀`;');
  const value = /const joined = (`.*?`);/.exec(collapsed)?.[1];
  assert.ok(value, `模板没匹配到：${collapsed}`);
  assert.equal(eval(value), '前缀甲\n乙后缀');
});

test('单引号里的 \\n 转义原样保留', () => {
  const collapsed = bodyOf("const list = ['甲', '乙'].join('\\n');");
  assert.match(collapsed, /join\('\\n'\)/);
});

test('带标签的模板按原始文本保留换行', () => {
  const collapsed = bodyOf('const raw = String.raw`甲\n乙`;');
  assert.match(collapsed, /String\.raw`甲\n乙`/);
});

test('油猴头注释保留，正文收成一行', () => {
  const collapsed = collapseUserscriptBody(`${HEADER}const a = 1;\nconst b = 2;\n`);
  assert.match(collapsed, /^\/\/ ==UserScript==/);
  assert.match(collapsed, /\/\/ ==\/UserScript==\n\nconst a = 1;const b = 2;\n$/);
});
