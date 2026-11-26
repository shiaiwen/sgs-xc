"use client";

import Image from "next/image";
import { useCallback, useEffect, useId, useMemo, useState } from "react";
import {
  AUTHOR_TIP_OPEN_EVENT,
  requestAuthorTipDialogOpen,
  shouldOpenAuthorTipFromSearch,
  stripAuthorTipQueryFromBrowserUrl,
} from "@/lib/author-tip-portal-query";
import {
  AUTHOR_TIP_PAY_CHANNEL_ALIPAY,
  AUTHOR_TIP_PAY_CHANNEL_WECHAT,
  authorTipChannelTabLabel,
  authorTipScanHint,
  type AuthorTipPayChannel,
} from "@/lib/author-tip-pay";
import {
  AUTHOR_TIP_PICK_CUSTOM,
  authorTipOptionKey,
  authorTipOptionsForChannel,
  authorTipPayHint,
  defaultAuthorTipPick,
  formatAuthorTipAmountYuan,
  normalizeAuthorTipPick,
  resolveAuthorTipQrImagePath,
  shouldCopyAuthorTipAmount,
  type AuthorTipPickValue,
} from "@/lib/author-tip-suggested-amounts";

type AuthorTipTriggerProps = {
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
  const [picked, setPicked] = useState<AuthorTipPickValue>(defaultAuthorTipPick);
  const [copyHint, setCopyHint] = useState("");

  const amountOptions = authorTipOptionsForChannel(channel);
  const qrPath = useMemo(
    () => resolveAuthorTipQrImagePath(channel, picked),
    [channel, picked],
  );
  const scanHint = authorTipScanHint(channel);

  function selectChannel(next: AuthorTipPayChannel): void {
    setChannel(next);
    setPicked((value) => normalizeAuthorTipPick(value, next));
    setCopyHint("");
  }

  function pickOption(option: ReturnType<typeof authorTipOptionsForChannel>[number]): void {
    setCopyHint("");
    if (option.custom) {
      setPicked(AUTHOR_TIP_PICK_CUSTOM);
      if (shouldCopyAuthorTipAmount(channel)) {
        setCopyHint("自定义金额，扫码后在付款页输入即可");
      }
      return;
    }
    const amountYuan = option.amountYuan ?? 0;
    setPicked(amountYuan);
    if (!shouldCopyAuthorTipAmount(channel)) return;
    const text = formatAuthorTipAmountYuan(amountYuan);
    void navigator.clipboard?.writeText(text).then(() => {
      setCopyHint(`已复制 ${text} 元，付款页粘贴或手输均可`);
    }).catch(() => {
      setCopyHint(`建议输入 ${text} 元`);
    });
  }

  const handleEscape = useCallback(
    (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (!open) return;
    setChannel(AUTHOR_TIP_PAY_CHANNEL_WECHAT);
    setPicked(defaultAuthorTipPick());
    setCopyHint("");
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
        <div className="portal-dialog__tabs mt-1" role="tablist" aria-label="赞赏方式">
          <button
            type="button"
            role="tab"
            aria-selected={channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT}
            className={
              channel === AUTHOR_TIP_PAY_CHANNEL_WECHAT
                ? "portal-dialog__tab portal-dialog__tab--active"
                : "portal-dialog__tab"
            }
            onClick={() => selectChannel(AUTHOR_TIP_PAY_CHANNEL_WECHAT)}
          >
            {authorTipChannelTabLabel(AUTHOR_TIP_PAY_CHANNEL_WECHAT)}
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
            onClick={() => selectChannel(AUTHOR_TIP_PAY_CHANNEL_ALIPAY)}
          >
            {authorTipChannelTabLabel(AUTHOR_TIP_PAY_CHANNEL_ALIPAY)}
          </button>
        </div>
        <div className="portal-dialog__amounts" role="group" aria-label="建议赞赏金额">
          {amountOptions.map((option) => {
            const active = option.custom
              ? picked === AUTHOR_TIP_PICK_CUSTOM
              : picked === option.amountYuan;
            return (
              <button
                key={authorTipOptionKey(option)}
                type="button"
                className={
                  active
                    ? "portal-dialog__amount portal-dialog__amount--active"
                    : "portal-dialog__amount"
                }
                onClick={() => pickOption(option)}
              >
                <span className="portal-dialog__amount-value">
                  {option.custom ? "自定义" : `${formatAuthorTipAmountYuan(option.amountYuan ?? 0)}元`}
                </span>
                <span className="portal-dialog__amount-label">{option.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-4 flex justify-center rounded-lg border border-line bg-surface p-3">
          <Image
            src={qrPath}
            alt={scanHint}
            width={220}
            height={220}
            className="h-auto w-[min(220px,100%)]"
            priority={false}
          />
        </div>
        <p className="mt-3 text-center text-sm text-muted">{authorTipPayHint(channel, picked)}</p>
        {copyHint ? <p className="mt-1 text-center text-xs text-muted">{copyHint}</p> : null}
      </div>
    </div>
  );
}

/** 全站只挂一份，负责弹窗与微端跳转自动打开。 */
export function AuthorTipDialogHost() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const openFromEvent = () => setOpen(true);
    window.addEventListener(AUTHOR_TIP_OPEN_EVENT, openFromEvent);
    return () => window.removeEventListener(AUTHOR_TIP_OPEN_EVENT, openFromEvent);
  }, []);

  useEffect(() => {
    if (!shouldOpenAuthorTipFromSearch(window.location.search)) return;
    stripAuthorTipQueryFromBrowserUrl();
    setOpen(true);
  }, []);

  return <AuthorTipDialog open={open} onClose={() => setOpen(false)} />;
}

export function AuthorTipTrigger({
  triggerClassName = "site-header__tip",
  triggerLabel = "赞赏作者",
}: AuthorTipTriggerProps) {
  return (
    <button
      type="button"
      className={triggerClassName}
      onClick={() => requestAuthorTipDialogOpen()}
    >
      {triggerLabel}
    </button>
  );
}

/** 内嵌页单独用：按钮与弹窗成对，不依赖 layout 里的 Host。 */
export function AuthorTipEntry({
  triggerClassName = "site-header__tip",
  triggerLabel = "赞赏作者",
}: AuthorTipTriggerProps) {
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