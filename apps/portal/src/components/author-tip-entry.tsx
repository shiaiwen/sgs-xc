"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useState } from "react";
import {
  AUTHOR_TIP_ALIPAY_IMAGE_PATH,
  AUTHOR_TIP_PAY_CHANNEL_ALIPAY,
  AUTHOR_TIP_PAY_CHANNEL_WECHAT,
  AUTHOR_TIP_WECHAT_IMAGE_PATH,
  type AuthorTipPayChannel,
} from "@/lib/author-tip-pay";

type AuthorTipEntryProps = {
  triggerClassName?: string;
  triggerLabel?: string;
};

function AuthorTipDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const [channel, setChannel] = useState<AuthorTipPayChannel>(AUTHOR_TIP_PAY_CHANNEL_WECHAT);

  const qrPath =
    channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT
      ? AUTHOR_TIP_WECHAT_IMAGE_PATH
      : AUTHOR_TIP_ALIPAY_IMAGE_PATH;
  const channelHint =
    channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT ? "微信扫一扫" : "支付宝扫一扫";

  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    setChannel(AUTHOR_TIP_PAY_CHANNEL_WECHAT);
    document.addEventListener("keydown", handleEscape);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = previousOverflow;
    };
  }, [open, handleEscape]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button
        type="button"
        className="absolute inset-0 bg-[rgba(31,28,24,0.4)]"
        aria-label="关闭赞赏弹窗"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="portal-dialog relative z-10 w-full max-w-sm p-5"
      >
        <header className="mb-3 flex items-start justify-between gap-3">
          <h2 id={titleId} className="text-lg font-semibold text-ink">
            赞赏作者
          </h2>
          <button
            type="button"
            className="border-0 bg-transparent px-1 py-0 text-2xl leading-none text-muted"
            aria-label="关闭"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <p className="text-sm leading-relaxed text-muted">
          小抄永久免费。觉得好用就扫个码支持一下，我继续好好干。
        </p>
        <div className="portal-dialog__tabs" role="tablist" aria-label="收款方式">
          <button
            type="button"
            role="tab"
            aria-selected={channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT}
            className={
              channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT
                ? "portal-dialog__tab portal-dialog__tab--active"
                : "portal-dialog__tab"
            }
            onClick={() => setChannel(AUTHOR_TIP_PAY_CHANNEL_WECHAT)}
          >
            微信
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={channel === AUTHOR_TIP_PAY_CHANNEL_ALIPAY}
            className={
              channel === AUTHOR_TIP_PAY_CHANNEL_ALIPAY
                ? "portal-dialog__tab portal-dialog__tab--active"
                : "portal-dialog__tab"
            }
            onClick={() => setChannel(AUTHOR_TIP_PAY_CHANNEL_ALIPAY)}
          >
            支付宝
          </button>
        </div>
        <div className="mt-5 flex justify-center rounded-lg border border-line bg-surface p-3">
          <Image
            src={qrPath}
            alt={channelHint}
            width={220}
            height={220}
            className="h-auto w-[min(220px,100%)]"
            priority={false}
          />
        </div>
        <p className="mt-3 text-center text-sm text-muted">{channelHint}</p>
      </div>
    </div>
  );
}

export function AuthorTipEntry({
  triggerClassName = "site-header__tip",
  triggerLabel = "赞赏作者",
}: AuthorTipEntryProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button type="button" className={triggerClassName} onClick={() => setOpen(true)}>
        {triggerLabel}
      </button>
      <AuthorTipDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}