/**
 * 山河地图配置源适配：从 CardConfigSource 取 ShanhetuMapConfigData。
 */

import type { CardConfigSource } from '../../adapters/card-config-source.ts';
import {
  isShanhetuMapConfigReady,
  type ShanhetuMapConfigData
} from './shanhetu-map-config-data.ts';

export interface ShanhetuMapConfigSource {
  get(): ShanhetuMapConfigData | null;
  ready(): boolean;
  dispose(): void;
}

/**
 * 山河配置挂在卡牌配置同源加载上（同一份 Config_w.sgs / 同一套解码库），
 * 避免再独立轮询解码库导致「卡牌已就绪、山河一直超时」。
 */
export function createShanhetuMapConfigSourceFromCardConfig(
  cardConfigSource: Pick<CardConfigSource, 'getShanhetuMapData'>
): ShanhetuMapConfigSource {
  return {
    get: () => cardConfigSource.getShanhetuMapData(),
    ready: () => isShanhetuMapConfigReady(cardConfigSource.getShanhetuMapData()),
    dispose() {
      // 生命周期由 CardConfigSource 管理。
    }
  };
}
