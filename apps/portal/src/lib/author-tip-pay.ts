/** 赞赏作者收款码渠道。 */
export const AUTHOR_TIP_PAY_CHANNEL_WECHAT = "wechat";
export const AUTHOR_TIP_PAY_CHANNEL_ALIPAY = "alipay";

export type AuthorTipPayChannel =
  | typeof AUTHOR_TIP_PAY_CHANNEL_WECHAT
  | typeof AUTHOR_TIP_PAY_CHANNEL_ALIPAY;

export const AUTHOR_TIP_WECHAT_IMAGE_PATH = "/pay/wechat.png";
export const AUTHOR_TIP_ALIPAY_IMAGE_PATH = "/pay/alipay.jpg";