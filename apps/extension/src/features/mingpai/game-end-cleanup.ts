/**
 * 局结束清理：当前同步阶段只停明牌、恢复游戏手牌区；下一微任务再卸层与清引擎。
 */

let cleanupGeneration = 0;
const cleanupTasks = new Set<() => void>();

export function registerMingpaiPostGameCleanup(task: () => void): () => void {
  cleanupTasks.add(task);
  return () => cleanupTasks.delete(task);
}

export function scheduleMingpaiPostGameCleanup(): void {
  const generation = ++cleanupGeneration;
  queueMicrotask(() => {
    if (generation !== cleanupGeneration) return;
    for (const task of cleanupTasks) {
      try {
        task();
      } catch {
        // 场景已销毁时忽略。
      }
    }
  });
}

/** 新一局开始前取消尚未执行的局后清理。 */
export function cancelMingpaiPostGameCleanup(): void {
  cleanupGeneration += 1;
}
