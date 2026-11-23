"use client";

import { useState } from "react";
import { maintainerContact } from "@/lib/site";

export function FeedbackAuthorContact() {
  const [copied, setCopied] = useState(false);

  async function copyQq() {
    try {
      await navigator.clipboard.writeText(maintainerContact.qq);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  return (
    <aside className="feedback-author-contact" aria-label="联系维护者">
      <h2 className="feedback-author-contact__title">需要直接沟通？</h2>
      <p className="feedback-author-contact__lead">
        工单适合留记录和查进度。着急、说不清、或想先发截图，可以用 QQ 找我。网页里不能直接唤起 QQ，请复制号码或用手机扫码。
      </p>
      <div className="feedback-author-contact__body">
        <div className="feedback-author-contact__text">
          <p className="feedback-author-contact__name">{maintainerContact.displayName}</p>
          <p className="feedback-author-contact__qq">
            QQ 号：<span className="feedback-author-contact__qq-num">{maintainerContact.qq}</span>
          </p>
          <button type="button" className="feedback-author-contact__copy btn-primary" onClick={copyQq}>
            {copied ? "已复制" : "复制 QQ 号"}
          </button>
          <p className="feedback-author-contact__steps">
            电脑：打开 QQ，搜索上面的号码加好友。手机：扫右侧二维码。
          </p>
        </div>
        <figure className="feedback-author-contact__qr">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={maintainerContact.qqQrImage}
            width={160}
            height={160}
            alt={`${maintainerContact.displayName} 的 QQ 二维码`}
          />
          <figcaption>手机 QQ 扫一扫加好友</figcaption>
        </figure>
      </div>
    </aside>
  );
}