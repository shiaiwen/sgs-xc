/** 赞赏收款渠道。 */
export const AUTHOR_TIP_PAY_CHANNEL_WECHAT = "wechat";
export const AUTHOR_TIP_PAY_CHANNEL_ALIPAY = "alipay";

export type AuthorTipPayChannel =
  | typeof AUTHOR_TIP_PAY_CHANNEL_WECHAT
  | typeof AUTHOR_TIP_PAY_CHANNEL_ALIPAY;

/** 支付宝非固定金额收款码 */
export const AUTHOR_TIP_ALIPAY_OTHER_IMAGE_PATH = "/pay/alipay-other.jpg";
/** 微信非固定金额收款码 */
export const AUTHOR_TIP_WECHAT_OTHER_IMAGE_PATH = "/pay/wechat-other.png";

export const AUTHOR_TIP_PAY_CDN_ORIGIN = "https://xc.95chong.cn";

export function authorTipAmountFileSlug(amountYuan: number): string {
  const text = String(amountYuan);
  const normalized = text.includes(".") ? text : String(amountYuan);
  return normalized.replaceAll(".", "-");
}

export function authorTipWechatImagePath(amountYuan: number): string {
  return `/pay/wechat-${authorTipAmountFileSlug(amountYuan)}.png`;
}

export function authorTipAlipayImagePath(amountYuan: number): string {
  return `/pay/alipay-${authorTipAmountFileSlug(amountYuan)}.jpg`;
}

export function authorTipWechatImageUrl(amountYuan: number): string {
  return `${AUTHOR_TIP_PAY_CDN_ORIGIN}${authorTipWechatImagePath(amountYuan)}`;
}

export function authorTipChannelTabLabel(channel: AuthorTipPayChannel): string {
  if (channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT) {
    return "微信";
  }
  return "支付宝";
}

export function authorTipScanHint(channel: AuthorTipPayChannel): string {
  if (channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT) {
    return "微信扫一扫";
  }
  return "支付宝扫一扫";
}