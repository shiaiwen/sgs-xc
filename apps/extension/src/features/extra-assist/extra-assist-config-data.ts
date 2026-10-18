/**
 * 进阶辅助配置解析：从 cha_spellextend 等表构建南华/许劭等数据结构。
 */

type UnknownRecord = Record<string, unknown>;

export interface ExtraAssistPeixiuReward {
  rewardId: number;
  name: string;
  description: string;
}

export interface ExtraAssistConfigData {
  nanHua: {
    trigger: Record<number, number>;
    effects: Array<{ type: number; text: string }>;
  };
  shiLun: Array<{
    id: number;
    name: string;
    spell: number;
    triggerID: number;
  }>;
  peiXiuRewards: Record<number, ExtraAssistPeixiuReward>;
}

/**
 * 从 cha_spellextend.sgs 解析南华触发、效果与许劭评鉴词条。
 */
export function buildExtraAssistConfigData(raw: unknown): ExtraAssistConfigData | null {
  const root = asRecord(raw);
  if (!root) return null;
  const triggers = asArray(root.NHtrigger);
  const effects = asArray(root.NHeffect);
  const words = asArray(root.XSPJ);
  const rewards = asArray(root.PXreward);
  if (!triggers.length && !effects.length && !words.length && !rewards.length) return null;

  const trigger: Record<number, number> = {};
  for (const entry of triggers) {
    const record = asRecord(entry);
    const id = Number(record?.triggerID);
    const type = Number(record?.triggerType);
    if (Number.isInteger(id) && id > 0) trigger[id] = type;
  }

  const nanHuaEffects = effects.map((entry) => {
    const record = asRecord(entry);
    const type = Number(record?.effectType) || 0;
    const text = String(record?.desc || '');
    return { type, text };
  }).filter((entry) => entry.type > 0 && entry.text)
    .sort((left, right) => left.type - right.type || left.text.length - right.text.length);

  const shiLun = words.map((entry) => {
    const record = asRecord(entry);
    return {
      id: Number(record?.id) || 0,
      name: String(record?.name || ''),
      spell: Number(record?.spell) || 0,
      triggerID: Number(record?.triggerID) || 0
    };
  }).filter((entry) => entry.id && entry.name && entry.spell);

  const peiXiuRewards: Record<number, ExtraAssistPeixiuReward> = {};
  for (const entry of rewards) {
    const record = asRecord(entry);
    const rewardId = Number(record?.ID ?? record?.id);
    if (!Number.isInteger(rewardId) || rewardId <= 0) continue;
    const description = String(record?.desc ?? record?.describe ?? record?.Desc ?? '')
      .replace(/<[^>]*>/g, '')
      .replace(/#.*/g, '')
      .replace(/[;\n]+$/g, '')
      .trim();
    peiXiuRewards[rewardId] = {
      rewardId,
      name: String(record?.name || `地图技#${rewardId}`),
      description
    };
  }

  return { nanHua: { trigger, effects: nanHuaEffects }, shiLun, peiXiuRewards };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value && typeof value === 'object' ? value as UnknownRecord : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
