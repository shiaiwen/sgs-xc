/**
 * 牌局动画分类：按特效路径、动画名和技能牌类型决定该归到哪一个屏蔽开关。
 */

export type PlaybackKind = 'sha' | 'shan' | 'heal' | 'trick' | 'equip' | 'skill';

const PRESERVE_ANIMATION = /^(?:tiesuo0[1-5](?:Back|[HLB])?|jiu(?:0[12]|2)?|FX_PaiJu_card_fengyao)$/;
const PRESERVE_PATH = /^(?:EFF_jiu|EFF_hejiu)$/;
const TRICK_ANIMATIONS = new Set([
  'wanjianqifa2',
  'wanjianqifaScene',
  'wanjianqifaHandCard',
  'wanjianqifaDodge',
  'zjzb',
  'liangleichadao',
  'lgzw',
  'tiesuo',
  'huogong',
  'wuxie',
  'nanmanhit',
  'jiaoyin'
]);

export interface PlaybackCard {
  IsEquip?: boolean;
  IsJinNang?: boolean;
  IsSkill?: boolean;
  ID?: unknown;
  SkillId?: unknown;
}

/** 基础牌：1 杀、2 闪、3 桃。装备、锦囊、武将技能各自归类。 */
export function kindFromCard(card: PlaybackCard | Record<string, unknown> | null | undefined): PlaybackKind | '' {
  if (!card) return '';
  const record = card as PlaybackCard;
  if (record.IsEquip) return 'equip';
  if (record.IsJinNang) return 'trick';
  if (record.IsSkill) return 'skill';
  const id = Number(record.ID ?? record.SkillId);
  if (id === 1) return 'sha';
  if (id === 2) return 'shan';
  if (id === 3) return 'heal';
  return '';
}

/**
 * 播放中的一条特效。铁索和酒的骨骼同时是状态标记，不拦截。
 * 看不出类别时返回空字符串，调用方继续播原动画。
 */
export function classifyPlayback(
  effectPath: unknown,
  animationName: unknown,
  skillKind: (skillId: number) => PlaybackKind | '' = () => ''
): PlaybackKind | '' {
  const path = String(effectPath || '');
  const name = String(animationName || '');
  if (PRESERVE_ANIMATION.test(name) || PRESERVE_PATH.test(path)) return '';
  if (path.includes('EF_Basic_Sha')) return 'sha';
  if (path.includes('EFF_shan') || path.includes('EF_Basic_Shan')) return 'shan';
  if (path.includes('OtherEffect/FX_MatchGame_huixie_')) return 'heal';
  if (path.startsWith('res/assets/animate/equip') || path.includes('/neweffect/equip/')) return 'equip';
  if (path.includes('/neweffect/skill/') || path.includes('GeneralSkillEffect')) return 'skill';
  if (TRICK_ANIMATIONS.has(name)) return 'trick';
  const skillId = Number(/^3d_(\d+)_/.exec(name)?.[1]);
  const fromSkill = Number.isFinite(skillId) ? skillKind(skillId) : '';
  if (fromSkill) return fromSkill;
  if (/^(?:EF_Plot_|Plot_)/.test(path) || /^(?:EF_NanManRuQin|EFF_NanManRuQing)/.test(path)) return 'trick';
  return '';
}
