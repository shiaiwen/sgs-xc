/** 开「全局背景」且小抄背景已显示时，需暂时隐藏场景自带底图的 SceneName。 */
export const PAPER_ALL_PAPER_HIDE_SCENE_BACKGROUND_SCENES = ['ModeScene', 'RogueLike1v1Scene'] as const;

/** 登录后的首页（选模式页）。没有牌桌也没有座位，只在开了全局背景时才显示小抄背景。 */
export const PAPER_HOME_SCENE_NAMES: readonly string[] = ['ModeScene'];

/** 首页和大厅房间列表。全局背景关着时，切到这些页面就收起牌局里的背景。 */
export const PAPER_LOBBY_SCENE_NAMES: readonly string[] = ['HallScene', ...PAPER_HOME_SCENE_NAMES];

/** 游戏里牌局页面共同继承的场景类名。房间、大厅和各模式入口页都不继承它。 */
export const PAPER_MATCH_SCENE_CLASS_NAME = 'TableGameScene';
