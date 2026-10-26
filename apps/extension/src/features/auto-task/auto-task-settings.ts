/**
 * 自动任务设置项：总开关与领取项声明。
 * 配置键仍为 skip*：true 表示跳过；界面勾选表示要领，读写时取反。
 */

import type { XiaochaoConfigKey } from '../../config/config-schema.ts';

export type AutoTaskSkipKey = XiaochaoConfigKey & `autoTask.skip${string}`;

export interface AutoTaskSkipSetting {
  key: AutoTaskSkipKey;
  label: string;
  tooltip: string;
}

export const AUTO_TASK_ENABLED_KEY = 'autoTask.enabled' satisfies XiaochaoConfigKey;

export const AUTO_TASK_ENABLED_TOOLTIP = '打开后按下面勾选的项自动领取\n'
  + '也会顺带做砍树、敲鼓、活跃任务、月卡、签到、皮肤册奖励等\n'
  + '自动化操作存在账号风险，请自行斟酌';

/** 配置为 true 表示跳过；设置页勾选表示要领，读写时取反。 */
export const AUTO_TASK_SKIP_SETTINGS: readonly AutoTaskSkipSetting[] = [
  { key: 'autoTask.skipTavern', label: '酒馆', tooltip: '自动领取酒馆碎片任务，并同步酒馆进度' },
  { key: 'autoTask.skipMail', label: '邮件', tooltip: '自动领取邮件附件' },
  { key: 'autoTask.skipDailyGeneralBag', label: '武将包', tooltip: '自动领取每日免费武将包' },
  { key: 'autoTask.skipFreeBless', label: '免费祈福', tooltip: '免费祈福出现红点时自动祈一次，不消耗祈福灯' },
  {
    key: 'autoTask.skipSignTrialCard',
    label: '体验卡',
    tooltip: '签到里的体验武将会进将池，勾选才会自动领'
  },
  { key: 'autoTask.skipDiJiaQuan', label: '抵价券', tooltip: '领取含抵价券的奖励' },
  {
    key: 'autoTask.skipHuanLeDou',
    label: '欢乐豆',
    tooltip: '领取含欢乐豆的奖励、官阶每日俸禄；低于 600 豆时也会领免费豆'
  },
  {
    key: 'autoTask.skipFreeTreasureFlip',
    label: '翻翻乐',
    tooltip: '奇珍翻翻乐当天能免费翻的时候自动翻一张，不消耗道具'
  }
];

export const ALL_AUTO_TASK_KEYS: readonly XiaochaoConfigKey[] = [
  AUTO_TASK_ENABLED_KEY,
  ...AUTO_TASK_SKIP_SETTINGS.map(({ key }) => key)
];
