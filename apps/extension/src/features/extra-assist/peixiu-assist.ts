/**
 * 裴秀辅助入口：把地图模型、路线规划与视图串起来。
 */

import type { LayaObjectLocator, LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { createMethodPatcher, type MethodPatcher } from '../../runtime/method-patch.ts';
import { locateGameScene } from '../seat-display/game-scene-locator.ts';
import {
  PEIXIU_ACTIVE_POLL_MS,
  PEIXIU_HAND_WATCH_MS,
  PEIXIU_SEARCH_POLL_MS
} from '../../const/peixiu.ts';
import {
  fingerprintMapConfig,
  isBoardCell,
  normalizeCell,
  parsePeixiuMapConfig,
  type PeixiuRewardInfo
} from './peixiu-map-model.ts';
import {
  appendRewardIds,
  collectPeixiuResources,
  readCurrentSeatId,
  readSelfSeatId,
  defaultMapCityRewardId,
  resolveRewardIdAt,
  rewardIdsCollectedSince,
  type PeixiuCardLookup
} from './peixiu-resources.ts';
import { planPeixiuRoute } from './peixiu-route-planner.ts';
import {
  destroyPeixiuOverlay,
  hidePeixiuOverlay,
  renderPeixiuRoute,
  type PeixiuOverlayHost
} from './peixiu-map-view.ts';
import type { PeixiuRouteStore } from './peixiu-route-store.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';
import {
  isNativeHudSuspended,
  registerNativeHudPostGameTeardown
} from '../../runtime/native-hud-post-game-guard.ts';

type UnknownRecord = Record<string, unknown>;

export interface PeixiuAssistOptions {
  isEnabled: () => boolean;
  locator: LayaObjectLocator;
  patcher?: MethodPatcher;
  globalObject?: LayaRuntimeWindow;
  cardLookup?: PeixiuCardLookup;
  getReward?: (rewardId: number) => PeixiuRewardInfo | null;
  findRewardByName?: (name: string) => number;
  routeStore?: PeixiuRouteStore;
  pollIntervalMs?: number;
  /** 回合切换时变化。回合结束清空已获得的城。 */
  getTurnKey?: () => string;
  gameEvents?: GameEventBus;
}

function asRecord(value: unknown): UnknownRecord | null {
  return value !== null && (typeof value === 'object' || typeof value === 'function')
    ? value as UnknownRecord
    : null;
}

/** 当前背景是不是裴秀辅助用的那张。 */
export function isPeixiuBackground(node: unknown): node is PeixiuOverlayHost {
  const record = asRecord(node);
  const constructorName = String(asRecord(record?.constructor)?.name || '');
  return !!record && (
    record.name === 'PeiXiuMapBackground'
    || record.name === 'peixiuSpBg'
    // 正式服混淆后仍保留 resName === 'peixiuSpBg'。
    || record.resName === 'peixiuSpBg'
    || record._name === 'peixiuSpBg'
    || record.sceneName === 'PeiXiuMapBackground'
    || /PeiXiuMapBackground/i.test(constructorName)
  );
}

function hasUsableMapState(node: unknown): node is PeixiuOverlayHost {
  const record = asRecord(node);
  const mapState = asRecord(record?.mapState);
  return !!(
    record
    && mapState
    && mapState.mapConfig
  );
}

/** 完整宿主条件，防止其它带 mapState 的界面被误认成裴秀地图。 */
function isPeixiuMapHost(node: unknown): node is PeixiuOverlayHost {
  const record = asRecord(node);
  return !!(
    record
    && isPeixiuBackground(record)
    && hasUsableMapState(record)
    && Array.isArray(record.boardCellSlots)
    && record.boardEffectRoot
    && typeof record.refreshBoardEffectLayer === 'function'
    && typeof record.getMarkerPos === 'function'
  );
}

function isVisibleMap(node: PeixiuOverlayHost | null): node is PeixiuOverlayHost {
  if (!node || node.destroyed || node._destroyed) return false;
  if (!node.parent && !node._parent) return false;
  if (typeof node._visible === 'boolean') return node._visible;
  return node.visible !== false;
}

function walkForMap(root: unknown, seen = new Set<unknown>(), budget = 400): PeixiuOverlayHost | null {
  if (!root || typeof root !== 'object' || seen.size >= budget) return null;
  const queue: unknown[] = [root];
  while (queue.length && seen.size < budget) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || seen.has(current)) continue;
    seen.add(current);
    // 同一个场景可能残留已经隐藏或尚未初始化完成的 peixiuSpBg。
    // 只返回当前可计算的地图，否则继续向后寻找，避免旧对象阻塞新地图。
    if (isPeixiuMapHost(current) && isVisibleMap(current)) return current;
    const record = asRecord(current);
    for (const child of [
      record?.parent,
      record?._parent,
      record?.root,
      record?.view,
      record?.content,
      record?.SpecialBackground,
      record?.specialBackground,
      record?.peixiuSpBg,
      asRecord(record?.currentData)?.SpecialBackground,
      asRecord(record?.currentData)?.specialBackground
    ]) {
      if (child && !seen.has(child)) queue.push(child);
    }
    // 优先读取 _children，并兼容 Laya 新版本公开的 children。
    // 部分正式服构建没有 _children，遗漏 children 会导致地图已存在时永远扫描不到。
    const children = Array.isArray(record?._children)
      ? record!._children as unknown[]
      : Array.isArray(record?.children)
        ? record!.children as unknown[]
        : Array.isArray(record?._childs)
          ? record!._childs as unknown[]
          : [];
    for (const child of children) {
      if (child && !seen.has(child)) queue.push(child);
    }
  }
  return null;
}

function resolveCurrentCell(host: PeixiuOverlayHost): number {
  const mapState = asRecord(host.mapState);
  const config = asRecord(mapState?.mapConfig);
  const display = normalizeCell(host.displayCurrentPos ?? mapState?.currentPos ?? 0);
  if (isBoardCell(display) && (!config?.HasCell || (typeof config.HasCell === 'function' && config.HasCell(display)))) {
    return display;
  }
  const pre = normalizeCell(config?.precell ?? config?.PreCell ?? config?.start ?? 0);
  if (isBoardCell(pre)) return pre;
  return normalizeCell(config?.cellID ?? config?.id ?? 0);
}

function collectedCellsOf(host: PeixiuOverlayHost): number[] {
  const cells = asRecord(host.mapState)?.drawnCells;
  return (Array.isArray(cells) ? cells : []).map(normalizeCell).filter(isBoardCell);
}

/**
 * 按裴秀决策规则读取地图和手牌，把结果发布给 Vue 面板。
 * 仅自己回合且进阶辅助开启时计算。
 */
export function installPeixiuAssist(options: PeixiuAssistOptions): () => void {
  const patcher = options.patcher ?? createMethodPatcher();
  const globalObject = options.globalObject ?? (typeof window !== 'undefined' ? window as LayaRuntimeWindow : {});
  let pollIntervalMs = options.pollIntervalMs ?? PEIXIU_SEARCH_POLL_MS;
  const tracked = new Set<PeixiuOverlayHost>();
  // 旧实现会按 __xcPeiXiu* 属性清理自己的节点。绘制状态放到独立代理上，
  // 场景刷新时保留当前实现的路线层。
  const overlayHosts = new WeakMap<object, PeixiuOverlayHost>();
  let active: PeixiuOverlayHost | null = null;
  let disposed = false;
  let handWatchTimer: ReturnType<typeof setInterval> | null = null;
  let handSignature = '';
  /** 只在地图实例自己身上挂钩子；地图类的原型由所有地图共用，不能动。 */
  const patchedHosts = new WeakSet<object>();
  const skillScope: {
    gameContext: object | null;
    selfSeatId: string;
    mapKey: string;
    turnKey: string;
    baseline: Set<number>;
    homeCell: number;
    ownedIds: number[];
  } = {
    gameContext: null,
    selfSeatId: '',
    mapKey: '',
    turnKey: '',
    baseline: new Set<number>(),
    homeCell: 0,
    ownedIds: []
  };

  function report(stage: string, detail: UnknownRecord = {}): void {
    try {
      (globalObject as UnknownRecord).__XIAOCHAO_PEIXIU_DEBUG__ = {
        at: Date.now(),
        stage,
        enabled: options.isEnabled(),
        hostPatched: Boolean(active && patchedHosts.has(active)),
        ...detail
      };
    } catch { /* diagnostics must never affect the assist */ }
  }

  function overlayHostFor(source: PeixiuOverlayHost): PeixiuOverlayHost {
    const existing = overlayHosts.get(source);
    if (existing) return existing;
    const facade = {} as PeixiuOverlayHost;
    for (const key of ['mapState', 'boardEffectRoot', 'parent', 'destroyed'] as const) {
      Object.defineProperty(facade, key, {
        configurable: true,
        get: () => source[key]
      });
    }
    facade.getMarkerPos = (cell) => source.getMarkerPos?.call(source, cell) ?? { x: 0, y: 0 };
    facade.getDisplayedBoardPixelWidth = () => source.getDisplayedBoardPixelWidth?.call(source) ?? 0;
    facade.getDisplayedBoardPixelHeight = () => source.getDisplayedBoardPixelHeight?.call(source) ?? 0;
    facade.getBoardPixelWidth = () => source.getBoardPixelWidth?.call(source) ?? Number(asRecord(source.boardEffectRoot)?.width || 0);
    facade.getBoardPixelHeight = () => source.getBoardPixelHeight?.call(source) ?? Number(asRecord(source.boardEffectRoot)?.height || 0);
    facade.getBoardPixelSize = () => source.getBoardPixelSize?.call(source) ?? 0;
    overlayHosts.set(source, facade);
    return facade;
  }

  /** 手牌、选中、体力等影响路线的东西拼成一串，变了才重画。 */
  function readHandSignature(): string {
    const resources = collectPeixiuResources({ globalObject, cardLookup: options.cardLookup });
    return [
      resources.handCards.map((card) => [card.key, card.playable ? 1 : 0, card.selected ? 1 : 0].join(':')).join('|'),
      resources.selectedCardKey,
      resources.remainingSha,
      resources.hp ?? '',
      resources.maxHp ?? ''
    ].join('#');
  }

  /** 定时比对手牌，不包装手牌容器和手牌：那些方法在座位、手牌之间共用。 */
  function startHandWatch(): void {
    if (handWatchTimer != null) return;
    handSignature = '';
    handWatchTimer = globalObject.setInterval?.(() => {
      if (disposed || !options.isEnabled() || !active || !isVisibleMap(active)) return;
      const next = readHandSignature();
      if (next === handSignature) return;
      handSignature = next;
      redraw(active, true);
    }, PEIXIU_HAND_WATCH_MS) ?? null;
  }

  function stopHandWatch(): void {
    if (handWatchTimer == null) return;
    globalObject.clearInterval?.(handWatchTimer);
    handWatchTimer = null;
    handSignature = '';
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;

  function startPolling(): void {
    if (pollTimer != null) return;
    pollTimer = globalObject.setInterval?.(() => {
      tryAttach();
    }, pollIntervalMs) ?? null;
  }

  function stopPolling(): void {
    if (pollTimer == null) return;
    globalObject.clearInterval?.(pollTimer);
    pollTimer = null;
  }

  startPolling();
  tryAttach();

  function tryAttach(): void {
    if (disposed) return;
    if (isNativeHudSuspended()) {
      hideAll();
      clearActive();
      return;
    }
    if (!options.isEnabled()) {
      hideAll();
      return;
    }
    const scene = locateGameScene(globalObject);
    const currentScene = options.locator.scene();
    const stage = asRecord((globalObject as UnknownRecord).Laya)?.stage;
    const found = (isPeixiuMapHost(active) && isVisibleMap(active) ? active : null)
      || walkForMap(scene)
      || walkForMap(currentScene)
      || walkForMap(stage);
    if (found && activate(found)) return;
    report('map-not-found', {
      hasGameScene: Boolean(scene),
      hasScene: Boolean(currentScene),
      hasStage: Boolean(stage)
    });
    // 当前没有激活的地图时恢复较快扫描，便于及时发现新地图。
    if (pollIntervalMs !== PEIXIU_SEARCH_POLL_MS) {
      pollIntervalMs = PEIXIU_SEARCH_POLL_MS;
      if (pollTimer != null) {
        stopPolling();
        startPolling();
      }
    }
    if (active && isPeixiuMapHost(active) && isVisibleMap(active)) {
      options.routeStore?.clear();
    } else {
      clearActive();
    }
  }

  function activate(host: PeixiuOverlayHost | null): boolean {
    // 正式服经常混淆 constructor/name，但 mapState 结构保持稳定。
    if (!isVisibleMap(host) || !isPeixiuMapHost(host)) return false;
    if (active && active !== host) clearActive();
    // 地图第一次出现时记下主人。每次轮询都改写的话，地图会看起来属于当前行动的人。
    if (host.__xcPeiXiuRouteOwnerSeatID == null) {
      const owner = readCurrentSeatId(globalObject, options.locator.gameContext());
      if (owner) host.__xcPeiXiuRouteOwnerSeatID = owner;
    }
    tracked.add(host);
    active = host;
    // 地图已激活后降低轮询频率；地图变化靠地图实例上的钩子，手牌变化靠定时比对。
    pollIntervalMs = PEIXIU_ACTIVE_POLL_MS;
    if (pollTimer != null) {
      stopPolling();
      startPolling();
    }
    startHandWatch();
    report('map-active', {
      name: host.name,
      resName: host.resName,
      hasMapConfig: Boolean(asRecord(host.mapState)?.mapConfig),
      boardWidth: Number(asRecord(host.boardEffectRoot)?.width || 0),
      boardHeight: Number(asRecord(host.boardEffectRoot)?.height || 0)
    });
    // peixiuSpBg 只会挂到当前客户端正在操作的裴秀地图。正式服不同版本的
    // currentID / SeatID 口径并不稳定，不能让座位号误判阻断整条路线功能。
    if (patchedHosts.has(host)) {
      redraw(host);
    } else {
      patchedHosts.add(host);
      installHostPatches(host);
      redraw(host, true);
    }
    return true;
  }

  /** 钩子只定义在这张地图实例自己身上；游戏从原型再调用时走原方法，不会绕回包装。 */
  function installHostPatches(host: PeixiuOverlayHost): void {
    const target = host as unknown as UnknownRecord;
    for (const method of ['renderMapState', 'refreshBoardEffectLayer']) {
      patcher.wrap(target, method, (original) => function (this: PeixiuOverlayHost, ...args: unknown[]) {
        const result = original.apply(this, args);
        if (options.isEnabled() && this === host) activate(host);
        return result;
      });
    }
    patcher.wrap(target, 'HideOnScene', (original) => function (this: PeixiuOverlayHost, ...args: unknown[]) {
      hidePeixiuOverlay(overlayHostFor(host));
      options.routeStore?.clear();
      return original.apply(this, args);
    });
    const destroyName = typeof target.Destroy === 'function' ? 'Destroy' : 'destroy';
    patcher.wrap(target, destroyName, (original) => function (this: PeixiuOverlayHost, ...args: unknown[]) {
      destroyPeixiuOverlay(overlayHostFor(host), globalObject);
      tracked.delete(host);
      if (active === host) {
        active = null;
        stopHandWatch();
      }
      options.routeStore?.clear();
      return original.apply(this, args);
    });
  }

  function redraw(host: PeixiuOverlayHost, _force = false): void {
    if (!options.isEnabled() || !isVisibleMap(host)) {
      hidePeixiuOverlay(overlayHostFor(host));
      options.routeStore?.clear();
      return;
    }
    const mapState = asRecord(host.mapState);
    const config = mapState?.mapConfig;
    if (!config) {
      hidePeixiuOverlay(overlayHostFor(host));
      options.routeStore?.clear();
      return;
    }
    const resources = collectPeixiuResources({
      globalObject,
      cardLookup: options.cardLookup
    });
    const parsedMap = parsePeixiuMapConfig(config);
    const rawCollected = collectedCellsOf(host);
    const mapFingerprint = fingerprintMapConfig(config);
    const gameContext = asRecord(options.locator.gameContext())
      ?? asRecord((globalObject as UnknownRecord).GameContext);
    const selfSeatId = readSelfSeatId(globalObject, gameContext);
    const turnKey = options.getTurnKey?.() ?? '';
    if (skillScope.gameContext !== gameContext || skillScope.selfSeatId !== selfSeatId || skillScope.turnKey !== turnKey) {
      skillScope.gameContext = gameContext;
      skillScope.selfSeatId = selfSeatId;
      skillScope.turnKey = turnKey;
      skillScope.mapKey = '';
      skillScope.ownedIds = [];
    }
    const mapChanged = skillScope.mapKey !== mapFingerprint;
    // 同一回合里换图，新走到的城接在已有列表后面。
    // 新地图展开时已经画上的格子不算新获得。回合结束再清空。
    if (mapChanged) {
      const current = resolveCurrentCell(host);
      const start = parsedMap?.start ?? 0;
      skillScope.homeCell = resolveRewardIdAt(parsedMap, start) ? start : current;
      skillScope.mapKey = mapFingerprint;
      skillScope.baseline = new Set(rawCollected);
    }
    const rewardIds = rewardIdsCollectedSince(
      rawCollected,
      skillScope.baseline,
      (cell) => resolveRewardIdAt(parsedMap, cell),
      skillScope.homeCell ? [skillScope.homeCell] : []
    );
    const cityRewardId = defaultMapCityRewardId(parsedMap, {
      getReward: options.getReward,
      findByName: options.findRewardByName
    });
    if (cityRewardId && !rewardIds.includes(cityRewardId)) rewardIds.push(cityRewardId);
    skillScope.ownedIds = appendRewardIds(skillScope.ownedIds, rewardIds);
    // 路线状态只能使用游戏实际记录的已收集格。奖励 ID 可能跨地图复用，
    // 不能由“已获得技能”反向推断格子，否则会删错格并改变最佳首步。
    const collected = [...new Set(rawCollected)];
    const startCell = resolveCurrentCell(host);
    const progressKey = [mapFingerprint, startCell, collected.join(',')].join('#');
    const overlayHost = overlayHostFor(host);
    // 地图、当前位置或已领取格变化时，回到第一套（上策）路线。
    // 若沿用上一局/上一阶段点过的中策、下策索引，界面虽然仍可显示“上策”，
    // 实际绘制却可能继续取旧方案，导致司州首步看起来不是向下。
    if (host.__xcPeiXiuRouteProgressKey !== progressKey) {
      host.__xcPeiXiuRouteProgressKey = progressKey;
      overlayHost.__xcPeiXiuRouteVariant = 0;
      overlayHost.__xcPeiXiuRouteRenderSignature = '';
      host.__xcPeiXiuRouteCache = undefined;
    }
    const cacheKey = [
      'planner-v5',
      mapFingerprint,
      startCell,
      collected.join(','),
      resources.handCards.map((card) => [card.key, card.suit, card.kind, card.playable ? 1 : 0, card.selected ? 1 : 0].join(':')).join('|'),
      [
        resources.remainingSha === Infinity ? 'I' : resources.remainingSha,
        resources.jiuLimit,
        resources.peachLimit,
        resources.shandianLimit,
        resources.hasZhugeEquipped ? 1 : 0,
        resources.hp ?? 'U',
        resources.maxHp ?? 'U',
        resources.selectedCardKey
      ].join(',')
    ].join('#');
    const cached = asRecord(host.__xcPeiXiuRouteCache);
    let planned: ReturnType<typeof planPeixiuRoute>;
    try {
      planned = cached?.key === cacheKey
        ? cached.result
        : planPeixiuRoute(config, {
          startCell,
          collectedCells: collected,
          handCards: resources.handCards,
          remainingSha: resources.remainingSha,
          jiuLimit: resources.jiuLimit,
          peachLimit: resources.peachLimit,
          shandianLimit: resources.shandianLimit,
          hasZhugeEquipped: resources.hasZhugeEquipped,
          hp: resources.hp,
          maxHp: resources.maxHp,
          forcedFirstCardKey: resources.selectedCardKey
        });
    } catch (error) {
      report('route-plan-failed', { error: String((error as Error)?.stack || error) });
      options.routeStore?.clear();
      hidePeixiuOverlay(overlayHostFor(host));
      return;
    }
    host.__xcPeiXiuRouteCache = { key: cacheKey, result: planned };
    const skills = skillScope.ownedIds
      .map((id) => options.getReward?.(id) ?? { rewardId: id, name: `地图技#${id}`, description: '' })
      .filter((item) => item.name);
    if (planned) options.routeStore?.publish(planned, skills);
    else options.routeStore?.clear();
    const rendered = renderPeixiuRoute({
      host: overlayHost,
      planned,
      skills,
      globalObject,
      force: _force,
      onVariantChange: () => redraw(host, true)
    });
    report(rendered ? 'route-rendered' : 'route-render-skipped', {
      planned: Boolean(planned),
      solutions: planned?.solutions.length || 0,
      solutionSteps: planned?.solutions.map((solution) => solution.path.length) || [],
      rewardCells: planned?.map.rewardCells.length || 0,
      complete: planned?.complete === true,
      handCards: resources.handCards.length,
      startCell,
      collectedCells: collected.length,
      hasLayer: Boolean(asRecord(overlayHost.__xcPeiXiuRouteLayer)?.parent)
    });
  }

  function hideAll(): void {
    for (const host of tracked) hidePeixiuOverlay(overlayHostFor(host));
    if (active) hidePeixiuOverlay(overlayHostFor(active));
    options.routeStore?.clear();
  }

  function clearActive(): void {
    if (active) {
      hidePeixiuOverlay(overlayHostFor(active));
      destroyPeixiuOverlay(overlayHostFor(active), globalObject);
      options.routeStore?.clear();
    }
    active = null;
    stopHandWatch();
  }

  const teardownBattleOverlays = () => {
    hideAll();
    clearActive();
  };
  const unregisterHudTeardown = registerNativeHudPostGameTeardown(teardownBattleOverlays);
  const stopGameEvents = options.gameEvents?.subscribe((event) => {
    if (event.type === 'game-ended') teardownBattleOverlays();
  });

  return () => {
    disposed = true;
    unregisterHudTeardown();
    stopGameEvents?.();
    stopHandWatch();
    if (pollTimer != null) globalObject.clearInterval?.(pollTimer);
    for (const host of tracked) destroyPeixiuOverlay(overlayHostFor(host), globalObject);
    tracked.clear();
    active = null;
    options.routeStore?.clear();
    if (!options.patcher) patcher.restoreAll();
  };
}
