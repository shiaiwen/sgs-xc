/**
 * 打开背景页前预加载界面类和资源。列表要等这些资源好了再画。
 */

import type { LayaRuntimeWindow } from '../../adapters/laya-object-locator.ts';
import { asRecord, type UnknownRecord } from './skin-runtime.ts';

export const WALLPAPER_UI_CLASS_CANDIDATES = [
  'WallPaperUIView',
  'WallPaperView',
  'BgSetView',
  'WallSkinPanel',
  'WallPaperItem',
  'WallPaperSkinItem'
] as const;

/** 背景界面资源没加载成功时的提示。 */
export const WALLPAPER_UI_RESOURCE_LOAD_FAILED = '背景界面资源加载失败，请重新打开背景页';

/** 还没有收藏时列表上的说明。 */
export const WALLPAPER_FAVORITES_EMPTY_TEXT = '还没有收藏背景\n请在皮肤详情中点击“收藏背景”';

/** 有收藏，但列表格子还没准备好。 */
export const WALLPAPER_FAVORITES_NOT_READY_TEXT = '皮肤背景列表尚未就绪';

const PRELOAD_FLAG = '__xcWallPaperUiPreloadDone__';
const PRELOAD_PROMISE = '__xcWallPaperUiPreloadPromise__';
const PRELOAD_FAILED = '__xcWallPaperUiPreloadFailed__';

function touchClass(globalObject: LayaRuntimeWindow, className: string): void {
  const classUtils = asRecord(asRecord(globalObject.Laya)?.ClassUtils);
  const getClass = classUtils?.getClass as ((name: string) => unknown) | undefined;
  if (typeof getClass === 'function') getClass(className);
}

function tryLoadSgxGroup(globalObject: LayaRuntimeWindow): Promise<void> | null {
  const Laya = asRecord(globalObject.Laya);
  if (!Laya) return null;
  const classUtils = asRecord(Laya.ClassUtils);
  const getClass = classUtils?.getClass as ((name: string) => unknown) | undefined;
  if (typeof getClass !== 'function') return null;

  const loaderClassNames = [
    'ResourceLoader',
    'UIResourceLoader',
    'ViewResourceLoader',
    'WallPaperResourceLoader',
    'BgSetResourceLoader'
  ];
  for (const name of loaderClassNames) {
    try {
      const ctor = getClass(name) as (new () => UnknownRecord) | undefined;
      if (typeof ctor !== 'function') continue;
      const loader = new ctor();
      if (!('resNames' in loader) && typeof loader.load !== 'function' && typeof loader.Load !== 'function') {
        continue;
      }
      return new Promise<void>((resolve, reject) => {
        loader.resNames = ['sgx'];
        const finishOk = () => resolve();
        const finishErr = (error: unknown) => {
          const message = error instanceof Error ? error.message : WALLPAPER_UI_RESOURCE_LOAD_FAILED;
          reject(new Error(message || WALLPAPER_UI_RESOURCE_LOAD_FAILED));
        };
        loader.onResourceComplete = finishOk;
        loader.onComplete = finishOk;
        loader.onResourceError = (info: UnknownRecord) => {
          const group = String(info?.groupName || '');
          if (!group || group === 'sgx' || (Array.isArray(loader.resNames) && loader.resNames.includes(group))) {
            finishErr(new Error(WALLPAPER_UI_RESOURCE_LOAD_FAILED));
          }
        };
        loader.onError = finishErr;
        try {
          if (typeof loader.load === 'function') loader.load();
          else if (typeof loader.Load === 'function') loader.Load();
          else if (typeof loader.start === 'function') loader.start();
          else resolve();
        } catch (error) {
          finishErr(error);
        }
      });
    } catch {
      // 类名随版本变化
    }
  }
  return null;
}

/** 先碰到界面类，再有加载器时拉资源。失败时用上面的提示。 */
export function preloadWallPaperUiResources(globalObject: LayaRuntimeWindow): Promise<void> {
  const host = globalObject as UnknownRecord;
  if (host[PRELOAD_FLAG] === true) return Promise.resolve();
  if (host[PRELOAD_FAILED] instanceof Error) return Promise.reject(host[PRELOAD_FAILED]);
  const pending = host[PRELOAD_PROMISE];
  if (pending instanceof Promise) return pending as Promise<void>;

  const promise = Promise.resolve()
    .then(async () => {
      for (const className of WALLPAPER_UI_CLASS_CANDIDATES) {
        try {
          touchClass(globalObject, className);
        } catch {
          // 类名随版本变化，忽略单项失败。
        }
      }
      const sgx = tryLoadSgxGroup(globalObject);
      if (sgx) await sgx;
      host[PRELOAD_FLAG] = true;
      delete host[PRELOAD_FAILED];
    })
    .catch((error) => {
      const wrapped = error instanceof Error
        ? error
        : new Error(WALLPAPER_UI_RESOURCE_LOAD_FAILED);
      if (!wrapped.message) {
        wrapped.message = WALLPAPER_UI_RESOURCE_LOAD_FAILED;
      }
      host[PRELOAD_FAILED] = wrapped;
      delete host[PRELOAD_FLAG];
      throw wrapped;
    })
    .finally(() => {
      delete host[PRELOAD_PROMISE];
    });
  host[PRELOAD_PROMISE] = promise;
  return promise;
}

export function isWallPaperUiPreloadDone(globalObject: LayaRuntimeWindow): boolean {
  return (globalObject as UnknownRecord)[PRELOAD_FLAG] === true;
}

export function resetWallPaperUiPreloadStateForTests(globalObject: LayaRuntimeWindow): void {
  const host = globalObject as UnknownRecord;
  delete host[PRELOAD_FLAG];
  delete host[PRELOAD_PROMISE];
  delete host[PRELOAD_FAILED];
}
