import type { XiaochaoConfigKey } from '../../config/config-schema.ts';

export const ANNIVERSARY_ASSIST_ENABLED_KEY = 'anniversaryAssist.enabled' as const satisfies XiaochaoConfigKey;
export const ANNIVERSARY_ASSIST_CREDIT_ACCOUNT_KEY = 'anniversaryAssist.creditAccountId' as const satisfies XiaochaoConfigKey;

/** 仅配置值为 true 时视为开启，与文档一致。 */
export function isAnniversaryAssistEnabledValue(value: unknown): boolean {
  return value === true;
}