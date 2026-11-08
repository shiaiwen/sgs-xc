/**
 * 同一阶段、内容完全一样的记录只写第一条。
 * 面板打开时会反复触发同样的记录，不去重会把有用的记录挤出缓冲区。
 */
export function createDedupedTrace(
  emit: (kind: string, detail: Record<string, unknown>) => void
): (kind: string, detail: Record<string, unknown>) => void {
  const lastByPhase = new Map<string, string>();
  return (kind, detail) => {
    const phase = String(detail.phase ?? '');
    const signature = JSON.stringify(detail);
    const key = `${kind}:${phase}`;
    if (lastByPhase.get(key) === signature) return;
    lastByPhase.set(key, signature);
    emit(kind, detail);
  };
}
