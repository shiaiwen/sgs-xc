/**
 * 只在座位初始化刚结束时调用游戏自己的画法。
 * 调用方负责挑场景。人机靠之后关掉显示，这里不看编号。
 */

type UnknownRecord = Record<string, unknown>;

export function drawRealPlayerNameOnInit(manager: UnknownRecord): void {
  callMethod(manager, 'createPlayerNameBg');
  callMethod(manager, 'createPlayerName');
}

function callMethod(manager: UnknownRecord, name: string): void {
  const method = manager[name];
  if (typeof method !== 'function') return;
  try {
    method.call(manager);
  } catch {
    // 初始化中途失败就保持原样。
  }
}
