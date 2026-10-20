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
  noticeWindow: boolean;
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
  if (options.killEffect && isGameRewardPointMessage(className, payload)) {
    suppressGameRewardPointPayload(payload);
    return;
  }
  if (options.noticeWindow && isMarqueeBroadcastMessage(className, payload)) {
    suppressMarqueeBroadcastPayload(payload);
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

const MARQUEE_BROADCAST_CLASS = /marquee|broadcastchatgoods|chatgoods|chatsysnews|systemnotice|scrollnotice|luckdraw|lotterybroadcast/i;

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

/** 协议分发前是否应整包丢弃，避免游戏在改写后仍读缓存字段。 */
export function shouldDropNoticeProtocol(className: string, payload: UnknownRecord): boolean {
  return isMarqueeBroadcastMessage(className, payload);
}

function isMarqueeBroadcastMessage(className: string, payload: UnknownRecord): boolean {
  if (className === 'GsClientBroadcastChatGoods') return true;
  if (/marquee/i.test(className)) return true;
  if (/broadcastchatgoods|chatgoods/i.test(className)) return true;
  if (/chatmsg/i.test(className) && isMarqueeChatPayload(payload)) return true;
  if (MARQUEE_BROADCAST_CLASS.test(className) && !/chatmsg/i.test(className)) return true;
  return false;
}

/** 聊天协议里系统跑马灯：狗托文案或系统频道字段。 */
function isMarqueeChatPayload(payload: UnknownRecord): boolean {
  if (containsDogTuoText(payload)) return true;
  return readMarqueeChatChannel(payload) !== null;
}

function readMarqueeChatChannel(payload: UnknownRecord): number | null {
  const stack: UnknownRecord[] = [payload];
  const seen = new Set<UnknownRecord>();
  while (stack.length > 0 && seen.size < 12) {
    const record = stack.pop()!;
    if (seen.has(record)) continue;
    seen.add(record);
    for (const key of ['channel', 'Channel', 'msgType', 'MsgType', 'chatType', 'ChatType']) {
      const value = Number(record[key]);
      if (MARQUEE_CHAT_CHANNELS.has(value)) return value;
    }
    for (const nested of Object.values(record)) {
      if (nested && typeof nested === 'object' && !Array.isArray(nested)) stack.push(nested as UnknownRecord);
    }
  }
  return null;
}

/** 网页端系统滚动公告常用频道，与牌局内聊天区分。 */
const MARQUEE_CHAT_CHANNELS = new Set([6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);

function containsDogTuoText(payload: UnknownRecord): boolean {
  return matchesDogTuoText(collectTextDeep(payload).join(' '));
}

function matchesDogTuoText(text: string): boolean {
  const normalized = normalizeChatText(text);
  if (!normalized) return false;
  if (/祈愿台|琳琅绘卷|翻翻乐|天载阁|元藏/.test(normalized)) return true;
  if (/恭喜/.test(normalized) && /获得|抽奖/.test(normalized)) return true;
  return /抽奖\d+次/.test(normalized);
}

function collectTextDeep(payload: UnknownRecord, depth = 0): string[] {
  if (depth > 5) return [];
  const texts: string[] = [];
  const stack: unknown[] = [payload];
  const seen = new Set<unknown>();
  let steps = 0;
  while (stack.length > 0 && steps < 120) {
    const value = stack.pop();
    steps += 1;
    if (value == null) continue;
    if (typeof value === 'string') {
      if (value.trim()) texts.push(value);
      continue;
    }
    if (typeof value !== 'object' || seen.has(value)) continue;
    seen.add(value);
    if (value instanceof Uint8Array) {
      try {
        texts.push(new TextDecoder('utf-8').decode(value));
      } catch {
        // 非 UTF-8 字节串跳过。
      }
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) stack.push(item);
      continue;
    }
    const record = value as UnknownRecord;
    for (const nested of Object.values(record)) stack.push(nested);
  }
  return texts;
}

function suppressMarqueeBroadcastPayload(payload: UnknownRecord): void {
  payload.__xcNoticeBlocked = true;
  for (const key of [
    'ProtoObj', 'protoObj', 'proto', 'msg', 'content', 'text', 'Msg',
    'goods', 'Goods', 'goodsList', 'GoodsList', 'chatMsg', 'ChatMsg', 'Data', 'data'
  ]) {
    hideProperty(payload, key);
  }
  for (const chat of chatRecords(payload)) {
    for (const key of [
      'ProtoObj', 'protoObj', 'proto', 'msg', 'content', 'text', 'Msg',
      'goods', 'Goods', 'goodsList', 'GoodsList', 'chatMsg', 'ChatMsg'
    ]) {
      hideProperty(chat, key);
    }
  }
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
