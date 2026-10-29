/**
 * Laya 运行时对象定位：从事件监听者与方法特征字符串找回管理器单例及混淆方法。
 *
 * 游戏管理器不进 Laya 类表，只作为事件监听者的 caller 活着。
 * ServerProxy 比较特殊：挂在 WindowManager.proxy 上，不走普通 MANAGER_LOOKUPS。
 * 混淆方法名靠 METHOD_SIGNATURES 里的源码片段在原型上比对还原。
 */

import {
  locateGameEventDispatcher,
  locateSceneManager,
  type GameRuntimeWindow
} from '../features/seat-display/game-scene-locator.ts';

type UnknownRecord = Record<string, unknown>;

export interface LayaRuntimeWindow extends GameRuntimeWindow {
  GameContext?: unknown;
  Laya?: GameRuntimeWindow['Laya'] & {
    stage?: unknown;
    Browser?: { window?: { GameContext?: unknown } };
    timer?: { once?: (delay: number, caller: unknown, callback: () => void) => void };
    Event?: { STOPPED?: string };
  };
}

/**
 * 游戏管理器没有注册到 Laya 类表；它们订阅了某个分发器的事件，
 * 从监听者的 caller 取回单例。格式：[事件名, 分发器, 单例上必有的键]。
 */
const MANAGER_LOOKUPS: Record<string, readonly [string, string?, string?]> = {
  ActivityGameDataManager: ['RksSWJGDataNtf'],
  ActivityManager: ['ClientJDInfoNtf'],
  BlessManager: ['ClientQifuRankRep'],
  BlessNewManager: ['decodeClientQiFuNewData'],
  ChatSysNewsManager: ['decodeSSCChatmsgNtf', 'ServerProxy', 'timeOutNoticeId'],
  GameGeneralManager: ['ClientGeneralFromRep'],
  GameGoodsManager: ['DbsCcMovegoodsRep'],
  GameShopManager: ['CcGoodsPriceRep'],
  GeneralSkinManager: ['ClientSkinFromRep'],
  MailManager: ['decodeClientGetMailNtf'],
  NewFuLiManager: ['decodeSetOutGiftInfoResp'],
  NewPrivilegeCardManager: ['decodeServerNewPrivilegeCardDataResp'],
  OfficerManager: ['ClientOfficerInfoRep'],
  RogueLikePveManager: ['decodeRogueLikeDataSync'],
  TaskManager: ['SmsgTaskFailed'],
  TaskRedDotManager: ['EXCHANGE_RED_VIEW_FIRST_UPDATE', 'ActivityManager'],
  UserInfoManger: ['ClientTTRankInfoRep'],
  WelfareManger: ['ClientLotteryRep'],
  WindowManager: ['HIDE_WINDOW', 'GameEventDispatcher']
};

/** 混淆后的方法名按函数源码中的特征文本恢复；数组表示需同时包含。 */
const METHOD_SIGNATURES: Record<string, Record<string, string | readonly string[]>> = {
  ActivityManager: { SendGetWyqjTiyanCardReq: 'CLIENT_NEWBIE_WANT_STRONG_GENERAL_EXPERIENCE_CARD_REQ' },
  GameEventDispatcher: { ShowWindow: '弹窗被功能关闭拦截' },
  GameShopManager: { BuySingleItem: ['triggerTask', 'extraOperate', 'DealPassId'] },
  TaskManager: {
    RequestTaskAward: 'TaskRewardSelectWindow',
    GetAllTaskDataByTaskID: 'GetNoGetTaskDataByTaskID',
    RequestAcceptTask: 'RequestAcceptTask',
    reqTaskProgressByIds: 'reqTaskProgressByIds'
  }
};

/** 舞台子节点 layerOrder 与语义层名的对应；用于按层找窗口。 */
const LAYER_ORDER = [
  'BottomLayer',
  'BackgroundLayer',
  'SceneLayer',
  'AnimationLayer',
  'WindowLayer',
  'TopUILayer',
  'PromptLayer'
];

export interface LayaObjectLocator {
  manager(name: string): UnknownRecord | null;
  dispatcher(): UnknownRecord | null;
  scene(): UnknownRecord | null;
  gameScene(): UnknownRecord | null;
  gameContext(): UnknownRecord | null;
  baseEffectPrototype(): UnknownRecord | null;
  classPrototype(className: string): UnknownRecord | null;
  /** 通过 Laya 类表新建实例，用于读取仅挂在实例上的子对象原型；调用方负责销毁。 */
  createInstance(className: string): UnknownRecord | null;
  layer(layerName: string): UnknownRecord | null;
  window(name: string): UnknownRecord | null;
  findWindows(name: string): UnknownRecord[];
  findInLayer(layerName: string, name: string): UnknownRecord[];
  managerFromList(predicate: (manager: UnknownRecord) => boolean): UnknownRecord | null;
  /** 在 ServerProxy / ActivityManager / 分发器监听者及 managerList 上查找管理器。 */
  findManagerByPredicate(predicate: (manager: UnknownRecord) => boolean): UnknownRecord | null;
  obfuscatedMethodName(target: unknown, owner: string, method: string): string | null;
  /**
   * 解析 GameEventDispatcher.ShowWindow 的候选方法名。
   * 顺序：特征串 resolved → 当前包混淆名 `_` → 字面量 ShowWindow。
   * `_` 仅为逃生口；包体变更后仍以 obfuscatedMethodName 为准。
   */
  listShowWindowMethodNames(target: unknown): string[];
}

/** 只读定位器：不创建游戏实例，只从已有 Laya/场景对象上取管理器与方法引用。 */
export function createLayaObjectLocator(
  globalObject: LayaRuntimeWindow = window as LayaRuntimeWindow
): LayaObjectLocator {
  const managers = new Map<string, UnknownRecord>();
  let listenerScanDepth = 0;

  function dispatcher(): UnknownRecord | null {
    return locateGameEventDispatcher(globalObject);
  }

  /**
   * 按名取管理器单例。ServerProxy 从 WindowManager.proxy 取；
   * 其余按 MANAGER_LOOKUPS 从分发器监听者 caller 找回，结果缓存。
   */
  function manager(name: string): UnknownRecord | null {
    if (name === 'ServerProxy') {
      const windowManager = managers.get('WindowManager') ?? findManagerByCaller('WindowManager');
      if (windowManager) managers.set('WindowManager', windowManager);
      return asRecord(windowManager?.proxy);
    }
    const cached = managers.get(name);
    if (cached) return cached;
    const found = name === 'GameEventDispatcher'
      ? dispatcher()
      : findManagerByCaller(name);
    if (found) managers.set(name, found);
    return found;
  }

  function listenersOf(source: UnknownRecord | null, eventName: string): unknown[] {
    const bucket = asRecord(source?._events)?.[eventName];
    if (!bucket) return [];
    return Array.isArray(bucket) ? bucket : [bucket];
  }

  function callerFromListener(listener: unknown): UnknownRecord | null {
    return asRecord(asRecord(listener)?.caller);
  }

  /**
   * 穷举 ServerProxy / ActivityManager / 分发器上的监听者 caller。
   * listenerScanDepth 防止 manager() 内部再扫时形成递归；预算 120 个事件键。
   */
  function findManagerByListenerScan(predicate: (caller: UnknownRecord) => boolean): UnknownRecord | null {
    if (listenerScanDepth > 0) return managerFromList(predicate);
    listenerScanDepth += 1;
    try {
      const fromList = managerFromList(predicate);
      if (fromList) return fromList;
      const sources = [manager('ServerProxy'), manager('ActivityManager'), dispatcher()];
      let scannedKeys = 0;
      const keyBudget = 120;
      for (const source of sources) {
        const events = asRecord(source?._events);
        if (!events) continue;
        for (const key of Object.keys(events)) {
          if (scannedKeys >= keyBudget) break;
          scannedKeys += 1;
          for (const listener of listenersOf(source, key)) {
            const caller = callerFromListener(listener);
            if (caller && predicate(caller)) return caller;
          }
        }
      }
      return null;
    } finally {
      listenerScanDepth -= 1;
    }
  }

  /** 按查找表事件名取 caller；NewFuLiManager 另有字段特征兜底。 */
  function findManagerByCaller(name: string): UnknownRecord | null {
    const lookup = MANAGER_LOOKUPS[name];
    if (!lookup) return null;
    const [eventName, dispatcherName = 'ServerProxy', requiredKey] = lookup;
    const source = manager(dispatcherName);
    const eventNames = name === 'NewFuLiManager'
      ? [eventName, 'SetOutGiftInfoResp']
      : [eventName];
    for (const key of eventNames) {
      for (const listener of listenersOf(source, key)) {
        const caller = callerFromListener(listener);
        if (caller && (!requiredKey || requiredKey in caller)) return caller;
      }
    }
    if (name === 'NewFuLiManager') {
      return findManagerByListenerScan((caller) => typeof caller.SendSetOutRewardAllReq === 'function'
        || caller.passDataDic !== undefined);
    }
    return null;
  }

  /** WindowManager 上的 managerList（构造器 / 实例 / 原型三处都试）。 */
  function managerListEntries(): UnknownRecord[] {
    const windowManager = manager('WindowManager');
    if (!windowManager) return [];
    const ctor = asRecord(windowManager.constructor);
    const candidates = [
      ctor?.managerList,
      windowManager.managerList,
      asRecord(ctor?.prototype)?.managerList
    ];
    for (const list of candidates) {
      if (!Array.isArray(list)) continue;
      return list.map(asRecord).filter((item): item is UnknownRecord => item !== null);
    }
    return [];
  }

  function managerFromList(predicate: (manager: UnknownRecord) => boolean): UnknownRecord | null {
    for (const record of managerListEntries()) {
      if (predicate(record)) return record;
    }
    return null;
  }

  function findManagerByPredicate(predicate: (manager: UnknownRecord) => boolean): UnknownRecord | null {
    return managerFromList(predicate) ?? findManagerByListenerScan(predicate);
  }

  function scene(): UnknownRecord | null {
    return asRecord(locateSceneManager(globalObject)?.CurrentScene);
  }

  function gameScene(): UnknownRecord | null {
    return locateSceneManager(globalObject)?.IsGameScene ? scene() : null;
  }

  /** GameContext 可能在 window 或 Laya.Browser.window；用特征方法辨认。 */
  function gameContext(): UnknownRecord | null {
    const candidates = [
      globalObject.GameContext,
      globalObject.Laya?.Browser?.window?.GameContext
    ];
    for (const candidate of candidates) {
      const record = asRecord(candidate);
      if (typeof record?.GetModeVO === 'function' || typeof record?.CanOperationInGame === 'function') {
        return record;
      }
    }
    return null;
  }

  /**
   * 原版在局内用 SelfSeatUi.getEffectType(2) 取 BaseEffect；大厅没有座位时
   * 改为在显示树中找一个已有特效节点，不创建任何游戏窗口。
   */
  function baseEffectPrototype(): UnknownRecord | null {
    const selfSeatUi = asRecord(gameScene()?.SelfSeatUi);
    const getEffectType = selfSeatUi?.getEffectType;
    if (typeof getEffectType === 'function') {
      try {
        const owner = effectMethodOwner(asRecord(getEffectType.call(selfSeatUi, 2)));
        if (owner) return owner;
      } catch {
        // 回退到显示树查找。
      }
    }
    const queue = children(asRecord(globalObject.Laya?.stage) ?? {});
    for (let index = 0; index < queue.length && index < BASE_EFFECT_SCAN_LIMIT; index += 1) {
      const owner = effectMethodOwner(queue[index], true);
      if (owner) return owner;
      queue.push(...children(queue[index]));
    }
    return null;
  }

  function classPrototype(className: string): UnknownRecord | null {
    try {
      const constructor = globalObject.Laya?.ClassUtils?.getClass?.(className) as { prototype?: unknown } | undefined;
      return asRecord(constructor?.prototype);
    } catch {
      return null;
    }
  }

  function createInstance(className: string): UnknownRecord | null {
    try {
      const classUtils = asRecord(asRecord(globalObject.Laya)?.ClassUtils);
      const getInstance = classUtils?.getInstance;
      const instance = typeof getInstance === 'function' ? asRecord(getInstance.call(classUtils, className)) : null;
      if (typeof instance?.Init === 'function') (instance.Init as () => void)();
      return instance;
    } catch {
      return null;
    }
  }

  function layer(layerName: string): UnknownRecord | null {
    const stage = asRecord(globalObject.Laya?.stage);
    if (!stage) return null;
    return children(stage).find((child) => child.layerOrder === LAYER_ORDER.indexOf(layerName)) ?? null;
  }

  function findInLayer(layerName: string, name: string): UnknownRecord[] {
    const stage = asRecord(globalObject.Laya?.stage);
    if (!stage) return [];
    const layers = children(stage).filter((child) => child.layerOrder === LAYER_ORDER.indexOf(layerName));
    return layers.flatMap((layer) => children(layer).filter((child) => (
      child.name === name || child.sceneName === name || asRecord(child.constructor)?.name === name
    )));
  }

  function findWindows(name: string): UnknownRecord[] {
    return findInLayer('WindowLayer', name);
  }

  /** 先查 WindowInstanceDict，没有再扫 WindowLayer 显示树。 */
  function findWindow(name: string): UnknownRecord | null {
    const dict = asRecord(manager('WindowManager')?.WindowInstanceDict);
    const get = dict?.get;
    if (typeof get === 'function') {
      const found = asRecord(get.call(dict, name));
      if (found) return found;
    }
    return findWindows(name)[0] ?? null;
  }

  /**
   * 在原型上找源码包含签名片段的方法，返回混淆后的真实键名。
   * 实例上可能已被补丁包装，故同时查原型描述符与实例/备份键。
   */
  function obfuscatedMethodName(target: unknown, owner: string, method: string): string | null {
    const signature = METHOD_SIGNATURES[owner]?.[method];
    const record = asRecord(target);
    if (!signature || !record) return null;
    const fragments = typeof signature === 'string' ? [signature] : signature;
    const prototype = Object.getPrototypeOf(record) ?? asRecord(record.constructor)?.prototype;
    if (!prototype) return null;
    for (const key of Object.getOwnPropertyNames(prototype)) {
      if (key === 'constructor') continue;
      // 实例上的同名方法可能已被其他补丁包装，也需回查原型上的原函数。
      const candidates: unknown[] = [Object.getOwnPropertyDescriptor(prototype, key)?.value];
      for (const lookupKey of [key, `__${key}`]) {
        try {
          candidates.push(record[lookupKey]);
        } catch {
          // 访问器抛错时跳过。
        }
      }
      if (candidates.some((candidate) => {
        if (typeof candidate !== 'function') return false;
        // method-patch 包装后 toString 不再含特征串；顺着本库 ORIGINAL 链看原函数。
        let cursor = candidate;
        const seen = new Set();
        while (typeof cursor === 'function' && !seen.has(cursor)) {
          seen.add(cursor);
          const source = Function.prototype.toString.call(cursor);
          if (fragments.every((fragment) => source.includes(fragment))) return true;
          const original = cursor[Symbol.for('sgsxc.methodPatch.original')];
          if (typeof original !== 'function' || original === cursor) break;
          cursor = original;
        }
        return false;
      })) {
        return key;
      }
    }
    return null;
  }

  function listShowWindowMethodNames(target: unknown): string[] {
    const record = asRecord(target);
    if (!record) return [];
    const resolved = obfuscatedMethodName(record, 'GameEventDispatcher', 'ShowWindow');
    // '_' = 当前游戏包混淆名（见 sgsGame_inner ShowWindow）；正式路径优先信 resolved。
    const names: string[] = [];
    for (const name of [resolved, '_', 'ShowWindow']) {
      if (name && typeof record[name] === 'function' && !names.includes(name)) names.push(name);
    }
    return names;
  }

  return {
    manager,
    dispatcher,
    scene,
    gameScene,
    gameContext,
    baseEffectPrototype,
    classPrototype,
    createInstance,
    layer,
    window: findWindow,
    findWindows,
    findInLayer,
    managerFromList,
    findManagerByPredicate,
    obfuscatedMethodName,
    listShowWindowMethodNames
  };
}

/** 大厅无座位 UI 时，显示树扫描特效节点的上限，避免卡死。 */
const BASE_EFFECT_SCAN_LIMIT = 3000;

/** 返回原型链上自有 InitEffect/playEffect 的那一层，即 BaseEffect.prototype。 */
function effectMethodOwner(node: UnknownRecord | null, requireEffectUrl = false): UnknownRecord | null {
  if (!node || (requireEffectUrl && !('effectUrl' in node))) return null;
  for (let proto = Object.getPrototypeOf(node); proto && proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
    if (Object.prototype.hasOwnProperty.call(proto, 'InitEffect') && typeof proto.playEffect === 'function') {
      return proto as UnknownRecord;
    }
  }
  return null;
}

function children(node: UnknownRecord): UnknownRecord[] {
  const list = node._children;
  return Array.isArray(list) ? list.map(asRecord).filter((child): child is UnknownRecord => child !== null) : [];
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}
