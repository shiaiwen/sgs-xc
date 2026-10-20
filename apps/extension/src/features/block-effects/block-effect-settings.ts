/**
 * 屏蔽设置项声明：特效类与其它弹窗/跑马灯类，供设置页与控制器共用。
 */

import type { XiaochaoConfigKey } from '../../config/config-schema.ts';

export interface BlockSetting {
  key: XiaochaoConfigKey & `block.${string}`;
  label: string;
  tooltip?: string;
}

export const BLOCK_EFFECT_SETTINGS: readonly BlockSetting[] = [
  {
    key: 'block.selectEffect',
    label: '选中特效',
    tooltip: '屏蔽选中目标时的官阶动画'
  },
  {
    key: 'block.shaEffect',
    label: '杀特效',
    tooltip: '屏蔽杀的命中动画'
  },
  {
    key: 'block.shanEffect',
    label: '闪特效',
    tooltip: '屏蔽闪的动画'
  },
  {
    key: 'block.jinnangEffect',
    label: '锦囊特效',
    tooltip: '屏蔽锦囊牌的动画'
  },
  {
    key: 'block.equipEffect',
    label: '装备特效',
    tooltip: '屏蔽装备发动、命中和拖尾动画'
  },
  {
    key: 'block.shakeEffect',
    label: '受击特效',
    tooltip: '屏蔽角色被攻击时的震动等动画'
  },
  {
    key: 'block.healEffect',
    label: '回血特效',
    tooltip: '屏蔽桃、回血动画和回复播报'
  },
  {
    key: 'block.killEffect',
    label: '击杀特效',
    tooltip: '屏蔽击杀、连杀和高伤害播报'
  },
  {
    key: 'block.skillEffect',
    label: '武将特效',
    tooltip: '屏蔽武将大特效、形态转场、震屏和天书动画'
  },
  {
    key: 'block.selfSkinEffect',
    label: '己方动效',
    tooltip: '屏蔽自己皮肤的攻击、互动、技能等动画'
  },
  {
    key: 'block.otherSkinState',
    label: '他人动效',
    tooltip: '屏蔽他人皮肤的攻击、互动、技能等动画，动态皮肤按静态显示'
  },
  {
    key: 'block.laoXianWindow',
    label: '老仙特效',
    tooltip: '自动关闭南华老仙的天书特效窗口'
  },
  {
    key: 'block.entranceEffect',
    label: '登场动画',
    tooltip: '屏蔽武将、皮肤及山河首领进场动画'
  },
  {
    key: 'block.interactEffect',
    label: '牌局互动',
    tooltip: '屏蔽鲜花、鸡蛋等牌局互动动画'
  },
  {
    key: 'block.mvpWindow',
    label: 'MVP结算',
    tooltip: '跳过牌局结束后的MVP展示'
  }
];

export const BLOCK_OTHER_SETTINGS: readonly BlockSetting[] = [
  {
    key: 'block.adWindow',
    label: '广告',
    tooltip: '屏蔽大厅自动弹出的活动广告'
  },
  {
    key: 'block.noticeWindow',
    label: '狗托',
    tooltip: '屏蔽顶部滚动的狗托弹幕，含琳琅绘卷、祈愿台等出货广播'
  },
  {
    key: 'block.factionSlogan',
    label: '口号',
    tooltip: '屏蔽开局时玩家自动发送的势力口号'
  },
  {
    key: 'block.taskRedDot',
    label: '任务红点',
    tooltip: '隐藏任务相关的红点提示'
  },
  {
    key: 'block.packageWindow',
    label: '开包动画',
    tooltip: '屏蔽武将、皮肤等开包结果弹窗'
  },
  {
    key: 'block.probWindow',
    label: '出货动画',
    tooltip: '屏蔽祈愿台翻翻乐等出货弹窗'
  }
];

export const ALL_BLOCK_SETTINGS: readonly BlockSetting[] = [
  ...BLOCK_EFFECT_SETTINGS,
  ...BLOCK_OTHER_SETTINGS
];

export type BlockSettingKey = BlockSetting['key'];
