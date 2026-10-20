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
  cardConfigSource?: Pick<CardConfigSource, 'getShanhetuMapData'>;
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

  return {
    openShop: () => shop.openShop(),
    getShopPreview: () => shop.getPreview(),
    subscribeShopPreview: (listener) => shop.subscribePreview(listener),
    filterMessage: (payload, className) => {
      map.filterMessage(payload, className);
      shop.filterMessage(payload, className);
    },
    dispose() {
      map.dispose();
      story.dispose();
      shop.dispose();
    }
  };
}
