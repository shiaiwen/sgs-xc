/** 动态皮肤动画类型：技能。 */
export const SKIN_PLAY_TYPE_SKILL = 2;

/** 动态皮肤动画类型：转场。 */
export const SKIN_PLAY_TYPE_TRANSITION = 4;

/** 动态皮肤动画类型：技能第二段。 */
export const SKIN_PLAY_TYPE_SKILL_SECOND = 5;

/** 关掉技能特效时，动态皮肤里一起拦下的动画类型。 */
export const SKILL_SWITCH_SKIN_PLAY_TYPES: ReadonlySet<number> = new Set([
  SKIN_PLAY_TYPE_SKILL,
  SKIN_PLAY_TYPE_TRANSITION,
  SKIN_PLAY_TYPE_SKILL_SECOND
]);
