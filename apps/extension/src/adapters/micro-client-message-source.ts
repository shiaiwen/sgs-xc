/**
 * 游戏消息源：微端从 console.log 取协议，浏览器从 ServerProxy.event 取。
 * 同一条消息两边都会出现时只处理一次。
 */

import { createLayaObjectLocator } from './laya-object-locator.ts';
import { findGameMessage, translateGameMessages } from './game-message-adapter.ts';
import type { GameEvent, GameEventBus } from '../runtime/game-event-bus.ts';

type MessageListener = (...rawArguments: unknown[]) => void;
type UnknownRecord = Record<string, unknown>;
type MessageSourceName = 'console' | 'server-proxy';

interface MessageSourceDiagnostics {
  state: string;
  startedAt: number;
  deliveries: Record<MessageSourceName, number>;
  protocolMessages: number;
  protocolClassCounts: Record<string, number>;
  recentProtocolEvents: UnknownRecord[];
  translatedEventCounts: Record<string, number>;
  lastClassName: string;
  lastCardMovementInput: UnknownRecord | null;
  lastCardMovementEvent: UnknownRecord | null;
  duplicateCardMovementsSuppressed: number;
  serverProxy: {
    managerFound: boolean;
    hooked: boolean;
    calls: number;
    protocolCalls: number;
    lastEventName: string;
  };
}

type MicroClientMessageWindow = Window;

export interface MicroClientMessageSourceOptions {
  /** 游戏处理协议前改写原始对象，例如屏蔽设置。 */
  mutateMessage?: (payload: Record<string, unknown>, className: string) => void;
}

/** 接入游戏协议：控制台日志与 ServerProxy 分发互为补充。 */
export function installMicroClientMessageSource(
  gameEvents: GameEventBus,
  globalObject: MicroClientMessageWindow = window,
  options: MicroClientMessageSourceOptions = {}
): () => void {
  const recentPayloads = new Set<object>();
  const recentCardMovements = new Map<string, {
    startedAt: number;
    sourceCounts: Record<MessageSourceName, number>;
    emittedCount: number;
  }>();
  const diagnostics: MessageSourceDiagnostics = {
    state: 'active',
    startedAt: Date.now(),
    deliveries: { console: 0, 'server-proxy': 0 },
    protocolMessages: 0,
    protocolClassCounts: {},
    recentProtocolEvents: [],
    translatedEventCounts: {},
    lastClassName: '',
    lastCardMovementInput: null,
    lastCardMovementEvent: null,
    duplicateCardMovementsSuppressed: 0,
    serverProxy: {
      managerFound: false,
      hooked: false,
      calls: 0,
      protocolCalls: 0,
      lastEventName: ''
    }
  };
  (globalObject as unknown as UnknownRecord).__XIAOCHAO_MESSAGE_SOURCE__ = diagnostics;

  const listener: MessageListener = (...rawArguments) => {
    deliver(rawArguments, '', 'console');
  };

  function deliver(
    rawArguments: unknown[],
    fallbackClassName = '',
    source: MessageSourceName = 'console'
  ): void {
    diagnostics.deliveries[source] += 1;
    const message = findGameMessage(rawArguments);
    const payload = message?.payload ?? payloadFor(rawArguments, fallbackClassName);
    const className = message?.className || fallbackClassName || (payload ? readClassName(payload) : '');
    if (className) {
      diagnostics.protocolMessages += 1;
      diagnostics.lastClassName = className;
    }
    if (payload) {
      if (recentPayloads.has(payload)) return;
      recentPayloads.add(payload);
      setTimeout(() => recentPayloads.delete(payload), 0);
      if (!message && className && !readClassName(payload)) payload.ClassName = className;
      if (className === 'PubGsCMoveCard') {
        diagnostics.lastCardMovementInput = snapshotMovementPayload(payload, className);
      }
      if (options.mutateMessage && className) {
        try {
          options.mutateMessage(payload, className);
        } catch (error) {
          console.warn('[xiaochao] 协议改写失败', error);
        }
      }
    }
    translateGameMessages(rawArguments).forEach((event) => {
      diagnostics.translatedEventCounts[event.type] = (diagnostics.translatedEventCounts[event.type] ?? 0) + 1;
      if (event.type === 'cards-moved') {
        diagnostics.lastCardMovementEvent = {
          at: Date.now(),
          cardCount: event.cardCount,
          cardIds: [...event.cardIds],
          fromId: event.fromId,
          fromZone: event.fromZone,
          toId: event.toId,
          toZone: event.toZone,
          moveType: event.moveType
        };
        if (!shouldPublishCardMovement(event, source)) {
          diagnostics.duplicateCardMovementsSuppressed += 1;
          return;
        }
      }
      gameEvents.publish(event);
    });
  }

  /**
   * 同一协议移动可能同时从 console 和 ServerProxy 到达。短窗口内按两个来源的
   * 出现次数取最大值，压掉镜像事件，同时保留单个来源里真实重复的移动。
   */
  function shouldPublishCardMovement(
    event: Extract<GameEvent, { type: 'cards-moved' }>,
    source: MessageSourceName
  ): boolean {
    const now = Date.now();
    const signature = JSON.stringify([
      event.cardCount,
      event.cardIds,
      event.fromId,
      event.fromZone,
      event.fromPosition,
      event.fromZoneParam,
      event.toId,
      event.toZone,
      event.toPosition,
      event.toZoneParam,
      event.moveType,
      event.spellId,
      event.srcSeatId ?? null
    ]);
    const duplicateWindowMs = 1000;
    for (const [key, record] of recentCardMovements) {
      if (now - record.startedAt > duplicateWindowMs) recentCardMovements.delete(key);
    }

    const previous = recentCardMovements.get(signature);
    if (!previous || now - previous.startedAt > duplicateWindowMs) {
      recentCardMovements.set(signature, {
        startedAt: now,
        sourceCounts: {
          console: source === 'console' ? 1 : 0,
          'server-proxy': source === 'server-proxy' ? 1 : 0
        },
        emittedCount: 1
      });
      while (recentCardMovements.size > 256) {
        const oldest = recentCardMovements.keys().next().value;
        if (oldest === undefined) break;
        recentCardMovements.delete(oldest);
      }
      return true;
    }

    previous.sourceCounts[source] += 1;
    const expectedCount = Math.max(
      previous.sourceCounts.console,
      previous.sourceCounts['server-proxy']
    );
    if (previous.emittedCount >= expectedCount) return false;
    previous.emittedCount = expectedCount;
    return true;
  }

  const consoleLogSource = installConsoleLogSource(listener);
  const dispatcherSource = installServerProxySource(globalObject, deliver, diagnostics);

  return () => {
    consoleLogSource.restore();
    dispatcherSource.restore();
    diagnostics.state = 'disposed';
  };
}

/** 浏览器客户端不把协议打到控制台，分发时的事件名就是协议类名。 */
function installServerProxySource(
  globalObject: MicroClientMessageWindow,
  deliver: (rawArguments: unknown[], fallbackClassName?: string, source?: MessageSourceName) => void,
  diagnostics: MessageSourceDiagnostics
): { restore(): void } {
  const locator = createLayaObjectLocator(globalObject as never);
  let wrapped: ((this: unknown, type: unknown, data: unknown, ...rest: unknown[]) => unknown) | null = null;
  let original: UnknownRecord['event'] | null = null;
  let proxy: UnknownRecord | null = null;
  const timer = setInterval(() => {
    const found = asRecord(locator.manager('WindowManager')?.proxy);
    if (!found) return;
    diagnostics.serverProxy.managerFound = true;
    if (typeof found.event !== 'function') {
      diagnostics.serverProxy.hooked = false;
      return;
    }
    if (found.event === wrapped) return;
    proxy = found;
    original = found.event;
    wrapped = function (this: unknown, type: unknown, data: unknown, ...rest: unknown[]) {
      const className = typeof type === 'string' ? type : '';
      diagnostics.serverProxy.calls += 1;
      diagnostics.serverProxy.lastEventName = className;
      if (data && typeof data === 'object' && isProtocolEvent(className, data as UnknownRecord)) {
        diagnostics.serverProxy.protocolCalls += 1;
        const payload = data as UnknownRecord;
        diagnostics.protocolClassCounts[className] = (diagnostics.protocolClassCounts[className] ?? 0) + 1;
        diagnostics.recentProtocolEvents.push(snapshotProtocolEvent(className, payload));
        diagnostics.recentProtocolEvents = diagnostics.recentProtocolEvents.slice(-30);
        deliver([data], className, 'server-proxy');
      }
      return typeof original === 'function' ? original.call(this, type, data, ...rest) : undefined;
    };
    found.event = wrapped;
    diagnostics.serverProxy.hooked = found.event === wrapped;
  }, 1000);
  return {
    restore() {
      clearInterval(timer);
      if (proxy && wrapped && proxy.event === wrapped && original) proxy.event = original;
    }
  };
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === 'object' ? value as UnknownRecord : null;
}

function isProtocolEvent(className: string, payload: UnknownRecord): boolean {
  if (readClassName(payload)) return true;
  return /^(decode|Msg|Client|GsC|PubGs|Smsg|CClient|CGs|SSC|SsC)/.test(className)
    || /chatmsg/i.test(className);
}

function payloadFor(rawArguments: unknown[], fallbackClassName: string): UnknownRecord | null {
  if (!fallbackClassName) return null;
  for (let index = rawArguments.length - 1; index >= 0; index -= 1) {
    const candidate = rawArguments[index];
    if (candidate !== null && typeof candidate === 'object') return candidate as UnknownRecord;
  }
  return null;
}

function readClassName(payload: UnknownRecord): string {
  return typeof payload.ClassName === 'string'
    ? payload.ClassName
    : typeof payload.className === 'string' ? payload.className : '';
}

interface ConsoleLogSource {
  restore(): void;
}

function installConsoleLogSource(listener: MessageListener): ConsoleLogSource {
  const descriptor = Object.getOwnPropertyDescriptor(console, 'log');
  let downstreamLog: unknown = console.log;
  const wrappedLog = (...rawArguments: unknown[]) => {
    listener(...rawArguments);
    return typeof downstreamLog === 'function' ? downstreamLog.apply(console, rawArguments) : undefined;
  };
  try {
    // 游戏加载过程中会给 console.log 重新赋值；用 setter 接住赋值，只替换下游函数，
    // 否则包装被覆盖后协议消息会整局丢失。
    Object.defineProperty(console, 'log', {
      configurable: true,
      enumerable: descriptor?.enumerable ?? true,
      get: () => wrappedLog,
      set: (value: unknown) => {
        downstreamLog = value;
      }
    });
  } catch {
    return { restore: () => undefined };
  }
  return {
    restore() {
      if (console.log !== wrappedLog) return;
      try {
        if (descriptor) Object.defineProperty(console, 'log', descriptor);
        else delete (console as Partial<Console>).log;
      } catch {
        // 页面销毁时无需继续恢复不可写属性。
      }
    }
  };
}

function snapshotMovementPayload(payload: UnknownRecord, className: string): UnknownRecord {
  const message = asRecord(payload.msg) ?? asRecord(payload.Msg);
  const data = asRecord(payload.Data) ?? asRecord(payload.data);
  const nested = asRecord(payload.Protocol)
    ?? asRecord(payload.protocol)
    ?? asRecord(payload.ProtoObj)
    ?? asRecord(payload.protoObj)
    ?? asRecord(data?.Protocol)
    ?? asRecord(data?.protocol)
    ?? asRecord(data?.ProtoObj)
    ?? asRecord(data?.protoObj)
    ?? asRecord(message?.Protocol)
    ?? asRecord(message?.protocol)
    ?? asRecord(message?.ProtoObj)
    ?? asRecord(message?.protoObj)
    ?? data;
  const records = nested && nested !== payload ? [payload, nested] : [payload];
  const read = (...keys: string[]): unknown => {
    for (const record of records) {
      for (const key of keys) if (record[key] !== undefined) return record[key];
    }
    return undefined;
  };
  const rawCardIds = read('CardIDs', 'CardIds', 'cardIDs', 'cardIds', 'card_ids', 'card_list', 'CardList');
  const cardIds = rawCardIds && typeof rawCardIds === 'object' && Number.isInteger((rawCardIds as { length?: unknown }).length)
    ? Array.from(rawCardIds as ArrayLike<unknown>, Number).slice(0, 30)
    : [];
  return {
    at: Date.now(),
    className,
    payloadKeys: Object.keys(payload).slice(0, 40),
    bodyKeys: nested ? Object.keys(nested).slice(0, 40) : [],
    cardCount: read('CardCount', 'cardCount', 'card_count'),
    moveType: read('MoveType', 'moveType', 'move_type'),
    fromId: read('FromID', 'FromId', 'fromID', 'fromId', 'from_id'),
    fromZone: read('FromZone', 'fromZone', 'from_zone'),
    toId: read('ToID', 'ToId', 'toID', 'toId', 'to_id'),
    toZone: read('ToZone', 'toZone', 'to_zone'),
    cardIds
  };
}

function snapshotProtocolEvent(eventName: string, payload: UnknownRecord): UnknownRecord {
  const protocol = asRecord(payload.Protocol) ?? asRecord(payload.protocol);
  const data = asRecord(payload.Data) ?? asRecord(payload.data);
  const protoObject = asRecord(payload.ProtoObj)
    ?? asRecord(payload.protoObj)
    ?? asRecord(data?.ProtoObj)
    ?? asRecord(data?.protoObj);
  return {
    at: Date.now(),
    eventName,
    payloadClassName: readClassName(payload),
    payloadKeys: Object.keys(payload).slice(0, 35),
    protocolKeys: protocol ? Object.keys(protocol).slice(0, 25) : [],
    dataKeys: data ? Object.keys(data).slice(0, 35) : [],
    protoObjectKeys: protoObject ? Object.keys(protoObject).slice(0, 35) : []
  };
}
