/** 赞赏作者收款码渠道。 */
export const AUTHOR_TIP_PAY_CHANNEL_WECHAT = 'wechat';
export const AUTHOR_TIP_PAY_CHANNEL_ALIPAY = 'alipay';

export type AuthorTipPayChannel =
  | typeof AUTHOR_TIP_PAY_CHANNEL_WECHAT
  | typeof AUTHOR_TIP_PAY_CHANNEL_ALIPAY;

/** 与门户下载站同域，油猴与微端共用。 */
export const AUTHOR_TIP_WECHAT_IMAGE_URL = 'https://xc.95chong.cn/pay/wechat.png';
export const AUTHOR_TIP_ALIPAY_IMAGE_URL = 'https://xc.95chong.cn/pay/alipay.jpg';