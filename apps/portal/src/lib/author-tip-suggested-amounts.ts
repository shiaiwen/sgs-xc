import {
  AUTHOR_TIP_ALIPAY_OTHER_IMAGE_PATH,
  AUTHOR_TIP_PAY_CHANNEL_ALIPAY,
  AUTHOR_TIP_PAY_CHANNEL_WECHAT,
  AUTHOR_TIP_WECHAT_OTHER_IMAGE_PATH,
  authorTipAlipayImagePath,
  authorTipWechatImagePath,
  type AuthorTipPayChannel,
} from "@/lib/author-tip-pay";

export type AuthorTipSuggestedOption = {
  label: string;
  amountYuan?: number;
  custom?: boolean;
};

export const AUTHOR_TIP_PICK_CUSTOM = "custom" as const;
export type AuthorTipPickValue = number | typeof AUTHOR_TIP_PICK_CUSTOM;

/**
 * 微信侧每档对应 public/pay 下一张图，文件名见 authorTipWechatImagePath。
 * 改档位时请同步生成收款码并上传。
 */
export const AUTHOR_TIP_SUGGESTED_OPTIONS: readonly AuthorTipSuggestedOption[] = [
  { amountYuan: 6, label: "意思一下" },
  { amountYuan: 9.9, label: "奶茶" },
  { amountYuan: 18.8, label: "加油更新" },
  { amountYuan: 28.8, label: "抵点服务器" },
  { amountYuan: 66, label: "提供生产力" },
  { label: "其他金额", custom: true },
];

export function formatAuthorTipAmountYuan(amountYuan: number): string {
  const text = String(amountYuan);
  return text.includes(".") ? text : String(amountYuan);
}

export function defaultAuthorTipPick(): AuthorTipPickValue {
  const fallback = AUTHOR_TIP_SUGGESTED_OPTIONS.find((option) => typeof option.amountYuan === "number");
  const preferred = AUTHOR_TIP_SUGGESTED_OPTIONS.find((option) => option.amountYuan === 18.8);
  return preferred?.amountYuan ?? fallback?.amountYuan ?? 0;
}

function authorTipQrPathForChannel(channel: AuthorTipPayChannel, amountYuan: number): string {
  if (channel === AUTHOR_TIP_PAY_CHANNEL_ALIPAY) {
    return authorTipAlipayImagePath(amountYuan);
  }
  return authorTipWechatImagePath(amountYuan);
}

function authorTipOtherQrPath(channel: AuthorTipPayChannel): string {
  if (channel === AUTHOR_TIP_PAY_CHANNEL_ALIPAY) {
    return AUTHOR_TIP_ALIPAY_OTHER_IMAGE_PATH;
  }
  return AUTHOR_TIP_WECHAT_OTHER_IMAGE_PATH;
}

export function resolveAuthorTipQrImagePath(
  channel: AuthorTipPayChannel,
  pick: AuthorTipPickValue,
): string {
  if (pick === AUTHOR_TIP_PICK_CUSTOM) {
    return authorTipOtherQrPath(channel);
  }
  if (typeof pick === "number") {
    return authorTipQrPathForChannel(channel, pick);
  }
  const fallback = defaultAuthorTipPick();
  return typeof fallback === "number"
    ? authorTipQrPathForChannel(channel, fallback)
    : authorTipOtherQrPath(channel);
}

export function authorTipOptionKey(option: AuthorTipSuggestedOption): string {
  return option.custom ? AUTHOR_TIP_PICK_CUSTOM : String(option.amountYuan ?? "");
}

export function authorTipOptionsForChannel(_channel: AuthorTipPayChannel): readonly AuthorTipSuggestedOption[] {
  return AUTHOR_TIP_SUGGESTED_OPTIONS;
}

export function normalizeAuthorTipPick(pick: AuthorTipPickValue, _channel: AuthorTipPayChannel): AuthorTipPickValue {
  return pick;
}

export function authorTipPayHint(channel: AuthorTipPayChannel, pick: AuthorTipPickValue): string {
  const scanLabel =
    channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT ? "微信扫一扫" : "支付宝扫一扫";
  if (pick === AUTHOR_TIP_PICK_CUSTOM) {
    if (channel === AUTHOR_TIP_PAY_CHANNEL_ALIPAY) {
      return "扫码后在付款页输入你想支持的金额";
    }
    return "扫码后在付款页输入你想支持的金额";
  }
  if (typeof pick === "number") {
    return `当前 ${formatAuthorTipAmountYuan(pick)} 元收款码，${scanLabel}`;
  }
  return "先选上方金额";
}

export function shouldCopyAuthorTipAmount(_channel: AuthorTipPayChannel): boolean {
  return false;
}