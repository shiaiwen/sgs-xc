/** 开「全局背景」且自定义底已显示时，需暂时隐藏场景自带底图的 SceneName。 */
export const PAPER_ALL_PAPER_HIDE_SCENE_BACKGROUND_SCENES = ['ModeScene', 'RogueLike1v1Scene'] as const;

/** 登录后的首页（选模式页）。没有牌桌也没有座位，只在开了全局背景时才显示自定义背景。 */
export const PAPER_HOME_SCENE_NAMES: readonly string[] = ['ModeScene'];
