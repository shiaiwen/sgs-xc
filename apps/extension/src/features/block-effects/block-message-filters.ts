/**
 * 协议级屏蔽：击杀特效、他人动态皮肤、势力口号聊天消息改写。
 */

import { FACTION_SLOGANS } from './faction-slogans.ts';
import { generalSkinMessage } from '../skin-background/skin-runtime.ts';

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
  chatEmotion: boolean;
  /** 皮肤回包是不是别的玩家的。认不准时返回 false，不改。 */
  isOtherPlayerSkinMessage(message: UnknownRecord): boolean;
  /** 聊天消息是不是别的玩家的动画表情。认不准时返回 false，不改。 */
  isOtherPlayerBigFaceMessage(message: UnknownRecord): boolean;
}

/**
 * 在协议分发前改写消息：击杀特效把 Type 置 0；他人动态皮肤把别人的皮肤回包
 * state 置 0；势力口号删除游戏读取的 data.protoObj 使其不显示；动画表情删掉
 * 别人的大表情 protoObj 使其不显示。
 * 必须在游戏处理该协议前调用。
 */
export function applyBlockMessageFilters(
  payload: UnknownRecord,
  className: string,
  options: BlockMessageFilterOptions
): void {
  if (options.killEffect && isGameRewardPointMessage(className, payload)) {
    suppressGameRewardPointPayload(payload);
    return;
  }
  if (options.chatEmotion && isChatMessage(className)) {
    const chat = readChatRecord(payload);
    if (chat && options.isOtherPlayerBigFaceMessage(chat)) {
      hideChatProto(payload);
      return;
    }
  }
  if (options.factionSlogan && (isChatMessage(className) || containsFactionSlogan(payload))) {
    if (containsFactionSlogan(payload)) clearChatProto(payload);
    if (isChatMessage(className)) return;
  }
  if (className === 'ClientGeneralSkinRep' && options.otherSkinState) {
    const message = generalSkinMessage(payload);
    if (!message || !options.isOtherPlayerSkinMessage(message)) return;
    for (const item of message.GeneralSkinList as unknown[]) {
      if (item && typeof item === 'object') (item as UnknownRecord).state = 0;
    }
  }
}

function isChatMessage(className: string): boolean {
  return CHAT_MESSAGE_NAMES.has(className) || /chatmsg/i.test(className);
}

/** 聊天正文：游戏读 data.protoObj 前，聊天字段挂在 data 上。 */
function readChatRecord(payload: UnknownRecord): UnknownRecord | null {
  const data = asRecord(payload.data) ?? asRecord(payload.Data);
  if (data) return data;
  return isChatPayload(payload) ? payload : null;
}

function isChatPayload(record: UnknownRecord): boolean {
  return 'SpokerMan' in record || 'spokerMan' in record || 'chatMsg' in record || 'ChatMsg' in record;
}

/** 删掉聊天协议对象，游戏读不到大表情就不会画。 */
function hideChatProto(payload: UnknownRecord): void {
  for (const record of [payload, asRecord(payload.data) ?? asRecord(payload.Data)]) {
    if (!record) continue;
    for (const key of ['protoObj', 'ProtoObj', 'proto', 'msg']) {
      hideProperty(record, key);
    }
  }
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : null;
}

function isGameRewardPointMessage(className: string, payload: UnknownRecord): boolean {
  if (/GameRewardPoint/i.test(className)) return true;
  const nested = readClassName(payload);
  return nested ? /GameRewardPoint/i.test(nested) : false;
}

function suppressGameRewardPointPayload(payload: UnknownRecord): void {
  const stack: UnknownRecord[] = [payload];
  const seen = new Set<UnknownRecord>();
  while (stack.length > 0 && seen.size < 8) {
    const record = stack.pop()!;
    if (seen.has(record)) continue;
    seen.add(record);
    zeroRewardPointTypes(record);
    for (const key of ['data', 'Data', 'msg', 'Msg', 'ProtoObj', 'protoObj', 'protocol', 'Protocol']) {
      const nested = record[key];
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) stack.push(nested as UnknownRecord);
    }
  }
}

function zeroRewardPointTypes(record: UnknownRecord): void {
  for (const key of ['Type', 'type', 'RewardType', 'rewardType', 'PointType', 'pointType']) {
    if (key in record) record[key] = 0;
  }
}

function readClassName(payload: UnknownRecord): string {
  return typeof payload.ClassName === 'string'
    ? payload.ClassName
    : typeof payload.className === 'string' ? payload.className : '';
}

function containsFactionSlogan(payload: UnknownRecord): boolean {
  return chatRecords(payload).some((chat) => sloganText(chat) !== '');
}

function sloganText(chat: UnknownRecord): string {
  for (const value of Object.values(chat)) {
    if (typeof value !== 'string') continue;
    // 最短口号 7 个字符，短字符串先跳过，别白跑两次正则。
    if (value.length < 7) continue;
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
    // 数组是牌列表等数据，不是聊天正文，别把每个元素都当成记录扫一遍。
    if (Array.isArray(value)) return;
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
