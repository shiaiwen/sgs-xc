/**
 * 协议级屏蔽：击杀特效、他人动态皮肤、势力口号聊天消息改写。
 */

import { FACTION_SLOGANS } from './faction-slogans.ts';

type UnknownRecord = Record<string, unknown>;

const CHAT_MESSAGE_NAMES = new Set([
  'decodeSSCChatmsgNtf',
  'SSCChatmsgNtf',
  'SsCChatmsgNtf'
]);

export interface BlockMessageFilterOptions {
  killEffect: boolean;
  otherSkinState: boolean;
  factionSlogan: boolean;
  isOwnGeneral(generalId: number): boolean;
}

/**
 * 在协议分发前改写消息：击杀特效把 Type 置 0；他人动态皮肤把非本家
 * 武将的皮肤 state 置 0；势力口号删除游戏读取的 data.protoObj 使其不显示。
 * 必须在游戏处理该协议前调用。
 */
export function applyBlockMessageFilters(
  payload: UnknownRecord,
  className: string,
  options: BlockMessageFilterOptions
): void {
  if (className === 'CClientGameRewardPointNTF') {
    if (options.killEffect) payload.Type = 0;
    return;
  }
  if (options.factionSlogan && (isChatMessage(className) || containsFactionSlogan(payload))) {
    if (containsFactionSlogan(payload)) clearChatProto(payload);
    if (isChatMessage(className)) return;
  }
  if (className === 'ClientGeneralSkinRep' && options.otherSkinState) {
    const list = payload.GeneralSkinList;
    if (!Array.isArray(list)) return;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const skin = item as UnknownRecord;
      if (!options.isOwnGeneral(Number(skin.GeneralID))) skin.state = 0;
    }
  }
}

function isChatMessage(className: string): boolean {
  return CHAT_MESSAGE_NAMES.has(className) || /chatmsg/i.test(className);
}

function containsFactionSlogan(payload: UnknownRecord): boolean {
  return chatRecords(payload).some((chat) => sloganText(chat) !== '');
}

function sloganText(chat: UnknownRecord): string {
  for (const value of Object.values(chat)) {
    if (typeof value !== 'string') continue;
    const text = normalizeChatText(value);
    if (FACTION_SLOGANS.has(text)) return text;
  }
  return '';
}

function chatRecords(payload: UnknownRecord): UnknownRecord[] {
  const records: UnknownRecord[] = [];
  const seen = new Set<UnknownRecord>();
  const visit = (value: unknown, depth: number) => {
    if (!value || typeof value !== 'object' || seen.has(value as UnknownRecord) || depth > 3) return;
    const record = value as UnknownRecord;
    seen.add(record);
    records.push(record);
    if (depth === 3) return;
    for (const nested of Object.values(record)) visit(nested, depth + 1);
  };
  visit(payload, 0);
  return records;
}

function normalizeChatText(value: string): string {
  return value.replace(/<[^>]*>/g, '').replace(/\u0000/g, '').trim();
}

/** 删掉协议对象，并清掉已经解析出来的口号原文。网页端常从 ProtoObj 直接画。 */
function clearChatProto(payload: UnknownRecord): void {
  for (const chat of chatRecords(payload)) {
    for (const key of ['protoObj', 'ProtoObj', 'proto', 'msg']) {
      hideProperty(chat, key);
    }
    for (const [key, value] of Object.entries(chat)) {
      if (typeof value !== 'string') continue;
      if (!FACTION_SLOGANS.has(normalizeChatText(value))) continue;
      chat[key] = '';
    }
  }
}

function hideProperty(record: UnknownRecord, key: string): void {
  if (!(key in record)) return;
  try {
    Object.defineProperty(record, key, { configurable: true, value: undefined });
  } catch {
    try { delete record[key]; } catch { /* 冻结对象上删不掉时，上面的空字符串仍然生效。 */ }
  }
}
