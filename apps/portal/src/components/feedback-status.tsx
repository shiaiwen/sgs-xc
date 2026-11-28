"use client";

import { useCallback, useEffect, useState } from "react";
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
  const [refreshing, setRefreshing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);

  const reloadTicket = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) setRefreshing(true);
    try {
      const value = await fetchFeedbackTicket(token);
      setTicket(value);
      setError("");
      setLastSyncedAt(Date.now());
    } catch (loadError) {
      setTicket((prev) => {
        if (!prev) {
          setError(loadError instanceof Error ? loadError.message : "加载失败");
        }
        return prev;
      });
    } finally {
      if (!options?.silent) setRefreshing(false);
    }
  }, [token]);

  useEffect(() => {
    void reloadTicket();
  }, [reloadTicket]);

  // 用户收藏链接后定时拉取，管理端改状态无需主动通知也能看到更新。
  useEffect(() => {
    const timer = window.setInterval(() => {
      void reloadTicket({ silent: true });
    }, 30000);
    return () => window.clearInterval(timer);
  }, [reloadTicket]);

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
          <p className="feedback-status__success-title">收到了，谢谢</p>
          <p className="feedback-status__success-lead">
            你的反馈已经记下。请收藏本页或复制链接存到方便找的地方，有新进展会更新在这页上。
          </p>
          {uploadError ? (
            <p className="feedback-status__upload-error">
              附件没有传上去。文字反馈已经记下，请用本页下方 QQ 找我补传截图。
            </p>
          ) : null}
          <button type="button" className="btn-primary" onClick={copyLink}>
            {copied ? "已复制" : "复制本页链接"}
          </button>
        </div>
      ) : null}

      <div className="feedback-status__card">
        <div className="feedback-status__head">
          <div className="feedback-status__head-main">
            <span className={statusClass(ticket.status)}>{ticket.statusLabel}</span>
            <span className="feedback-status__type">{ticket.typeLabel}</span>
          </div>
          <div className="feedback-status__refresh">
            {lastSyncedAt ? (
              <span className="feedback-form__hint">
                更新于 {formatFeedbackTime(lastSyncedAt)}
              </span>
            ) : null}
            <button
              type="button"
              className="feedback-status__refresh-btn"
              disabled={refreshing}
              onClick={() => void reloadTicket()}
            >
              {refreshing ? "刷新中…" : "刷新进度"}
            </button>
          </div>
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
                  {/* 清理后保留原文件名供核对，不再渲染失效的下载链接。 */}
                  {item.deletedAt ? (
                    <span className="feedback-status__attachment-name">{item.name}</span>
                  ) : (
                    <a href={resolveFeedbackAttachmentUrl(item.url)} target="_blank" rel="noreferrer">
                      {item.name}
                    </a>
                  )}
                  <span>
                    {item.deletedAt ? "附件已过期清理" : formatAttachmentSize(item.size)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {ticket.status !== "received" || ticket.publicNote ? (
          <section className="feedback-status__section">
            <h2>处理说明</h2>
            <p className="feedback-status__note">
              {ticket.publicNote || "正在处理，说明稍后更新。"}
            </p>
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
