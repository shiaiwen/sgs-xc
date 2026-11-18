/** 特效播放方法里名字和播放参数所在的位置。播放参数里带坐标、命中回调和结束回调。 */
export interface EffectPlaybackArgLayout {
  /** 没有名字参数时为 null。 */
  nameIndex: number | null;
  optionsIndex: number;
}

/** 座位和全局播放器各自的特效控制器：数据、层、名字、播放参数。 */
export const EFFECT_CONTROLLER_ARGS: EffectPlaybackArgLayout = { nameIndex: 2, optionsIndex: 3 };

/** 全局特效播放器：数据、层、播放参数。转给自己的特效控制器时补一个空名字。 */
export const EFFECT_PLAYER_ARGS: EffectPlaybackArgLayout = { nameIndex: null, optionsIndex: 2 };

/** 多段播放在层后面多一个参数，名字和播放参数都往后挪这么多位。 */
export const MULTI_EFFECT_EXTRA_ARGS = 1;
