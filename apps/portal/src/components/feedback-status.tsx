"use client";

import { useEffect, useState } from "react";
import {
  fetchFeedbackTicket,
  formatAttachmentSize,
  formatFeedbackTime,
  resolveFeedbackAttachmentUrl,
  type FeedbackTicket,
} from "@/lib/feedback-api";

function statusClass(status: FeedbackTicket["status"]): string {
  return `feedback-status__badge feedback-status__badge--${status}`;
}

export function FeedbackStatus({
  token,
  isFresh,
  uploadError = false,
}: {
  token: string;
  isFresh: boolean;
  uploadError?: boolean;
}) {
  const [ticket, setTicket] = useState<FeedbackTicket | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    fetchFeedbackTicket(token)
      .then((value) => {
        if (active) setTicket(value);
      })
      .catch((loadError) => {
        if (active) setError(loadError instanceof Error ? loadError.message : "加载失败");
      });
    return () => {
      active = false;
    };
  }, [token]);

  async function copyLink() {
    const url = window.location.href.split("#")[0];
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  if (error) {
    return <p className="feedback-status__error">{error}</p>;
  }

  if (!ticket) {
    return <p className="feedback-status__loading">加载中…</p>;
  }

  return (
    <div className="feedback-status">
      {isFresh ? (
        <div className="feedback-status__success">
          <p className="feedback-status__success-title">提交成功</p>
          <p className="feedback-status__success-lead">
            请收藏本页，或复制链接发到微信文件传输助手。查进度只靠这条链接。
          </p>
          {uploadError ? (
            <p className="feedback-status__upload-error">
              附件没有传上去。文字反馈已经记下了，需要的话再发一次带截图的反馈。
            </p>
          ) : null}
          <button type="button" className="btn-primary" onClick={copyLink}>
            {copied ? "已复制" : "复制本页链接"}
          </button>
        </div>
      ) : null}

      <div className="feedback-status__card">
        <div className="feedback-status__head">
          <span className={statusClass(ticket.status)}>{ticket.statusLabel}</span>
          <span className="feedback-status__type">{ticket.typeLabel}</span>
        </div>

        <dl className="feedback-status__meta">
          <div>
            <dt>提交时间</dt>
            <dd>{formatFeedbackTime(ticket.submittedAt)}</dd>
          </div>
          <div>
            <dt>最后更新</dt>
            <dd>{formatFeedbackTime(ticket.updatedAt)}</dd>
          </div>
          {ticket.clientVersion ? (
            <div>
              <dt>版本</dt>
              <dd>{ticket.clientVersion}</dd>
            </div>
          ) : null}
        </dl>

        <section className="feedback-status__section">
          <h2>你的描述</h2>
          <p className="feedback-status__body">{ticket.body}</p>
        </section>

        {ticket.attachments.length ? (
          <section className="feedback-status__section">
            <h2>附件</h2>
            <ul className="feedback-status__attachments">
              {ticket.attachments.map((item) => (
                <li key={item.id}>
                  <a href={resolveFeedbackAttachmentUrl(item.url)} target="_blank" rel="noreferrer">
                    {item.name}
                  </a>
                  <span>{formatAttachmentSize(item.size)}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {ticket.publicNote ? (
          <section className="feedback-status__section">
            <h2>处理说明</h2>
            <p className="feedback-status__note">{ticket.publicNote}</p>
          </section>
        ) : null}

        {ticket.status === "fixed" && ticket.fixedVersion ? (
          <section className="feedback-status__section">
            <h2>修复版本</h2>
            <p>
              {ticket.fixedVersion}
              {ticket.changelogUrl ? (
                <>
                  {" "}
                  <a href={ticket.changelogUrl} target="_blank" rel="noreferrer">
                    查看更新说明
                  </a>
                </>
              ) : null}
            </p>
          </section>
        ) : null}

        {!isFresh ? (
          <button type="button" className="feedback-status__copy" onClick={copyLink}>
            {copied ? "链接已复制" : "复制进度链接"}
          </button>
        ) : null}
      </div>
    </div>
  );
}