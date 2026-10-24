/**
 * 山河图总控：组合地图透视、商店预览、剧情隐藏，并暴露 filterMessage / 设置联动。
 */

import type { XiaochaoConfigStore } from '../../config/config-store.ts';
import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import {
  createLayaObjectLocator,
  type LayaObjectLocator,
  type LayaRuntimeWindow
} from '../../adapters/laya-object-locator.ts';
import {
  installShanhetuMapController,
  type ShanhetuMapController
} from './shanhetu-map-controller.ts';
import {
  installShanhetuShopController,
  type ShanhetuShopController,
  type ShanhetuShopPreviewItem,
  type ShanhetuShopPreviewListener
} from './shanhetu-shop-controller.ts';
import {
  installShanhetuStoryController,
  type ShanhetuStoryController
} from './shanhetu-story-controller.ts';
import { installShanhetuZhanfaCount } from './shanhetu-zhanfa-controller.ts';
import { installShanhetuChangeGeneral } from './shanhetu-change-general-controller.ts';
import { installShanhetuAutoBattleController } from './shanhetu-auto-battle-controller.ts';
import type { GameEventBus } from '../../runtime/game-event-bus.ts';

type UnknownRecord = Record<string, unknown>;

export interface ShanhetuController {
  openShop(): boolean;
  getShopPreview(): readonly ShanhetuShopPreviewItem[];
  subscribeShopPreview(listener: ShanhetuShopPreviewListener): () => void;
  filterMessage(payload: UnknownRecord, className: string): void;
  dispose(): void;
}

export interface ShanhetuControllerOptions {
  globalObject?: LayaRuntimeWindow;
  locator?: LayaObjectLocator;
  documentObject?: Document;
  cardConfigSource?: Pick<CardConfigSource, 'getShanhetuMapData' | 'getGeneralName' | 'generalNamesReady'>;
  gameEvents?: GameEventBus;
  selfSeatId?: () => number | null;
}

/** 山河图三项：地图透视、隐藏对白、打开集市（含集市透视）。 */
export function installShanhetuController(
  configStore: XiaochaoConfigStore,
  options: ShanhetuControllerOptions = {}
): ShanhetuController {
  const globalObject = options.globalObject ?? (window as LayaRuntimeWindow);
  const locator = options.locator ?? createLayaObjectLocator(globalObject);
  const map: ShanhetuMapController = installShanhetuMapController(configStore, {
    globalObject,
    locator,
    cardConfigSource: options.cardConfigSource
  });
  const story: ShanhetuStoryController = installShanhetuStoryController(configStore, {
    globalObject,
    locator
  });
  const shop: ShanhetuShopController = installShanhetuShopController({
    globalObject,
    locator,
    cardConfigSource: options.cardConfigSource
  });
  const names = options.cardConfigSource;
  const stopChangeGeneral = names
    ? installShanhetuChangeGeneral({
      globalObject,
      locator,
      names
    })
    : () => undefined;
  const stopZhanfa = options.gameEvents
    ? installShanhetuZhanfaCount({
      globalObject,
      locator,
      gameEvents: options.gameEvents,
      selfSeatId: options.selfSeatId ?? (() => null)
    })
    : () => undefined;
  const stopAutoBattle = installShanhetuAutoBattleController(configStore, { globalObject, locator });

  return {
    openShop: () => shop.openShop(),
    getShopPreview: () => shop.getPreview(),
    subscribeShopPreview: (listener) => shop.subscribePreview(listener),
    filterMessage: (payload, className) => {
      map.filterMessage(payload, className);
      shop.filterMessage(payload, className);
    },
    dispose() {
      stopAutoBattle();
      stopZhanfa();
      stopChangeGeneral();
      map.dispose();
      story.dispose();
      shop.dispose();
    }
  };
}
