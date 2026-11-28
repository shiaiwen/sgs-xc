"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TicketUserInfo } from "@/components/ticket-user-info";
import { SelectField } from "@/components/ui/select-field";
import type { AdminTicket, FeedbackAdminStatus } from "@/lib/ticket-api";
import {
  STATUS_OPTIONS,
  deleteAdminTicket,
  patchAdminTicket,
  readSessionToken,
  userTicketViewUrl,
} from "@/lib/ticket-api";

type TicketDetailFormProps = {
  ticket: AdminTicket;
};

/** 单条工单：展示用户提交内容，并改状态与处理说明。 */
export function TicketDetailForm({ ticket }: TicketDetailFormProps) {
  const router = useRouter();
  const [status, setStatus] = useState<FeedbackAdminStatus>(ticket.status);
  const [publicNote, setPublicNote] = useState(ticket.publicNote || "");
  const [internalNote, setInternalNote] = useState(ticket.internalNote || "");
  const [busy, setBusy] = useState(false);
  const [deleteArmed, setDeleteArmed] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    setStatus(ticket.status);
    setPublicNote(ticket.publicNote || "");
    setInternalNote(ticket.internalNote || "");
  }, [ticket]);

  function cancelDelete() {
    setDeleteArmed(false);
    setError("");
  }

  async function onConfirmDelete() {
    const session = readSessionToken();
    if (!session) {
      router.replace("/login");
      return;
    }
    setDeleteBusy(true);
    setError("");
    try {
      await deleteAdminTicket(session, ticket.token);
      router.replace("/tickets");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "删除失败");
      setDeleteBusy(false);
    }
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    const session = readSessionToken();
    if (!session) {
      router.replace("/login");
      return;
    }
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await patchAdminTicket(session, ticket.token, {
        status,
        publicNote: publicNote.trim(),
        internalNote: internalNote.trim(),
      });
      setMessage("已保存");
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "保存失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ticket-detail">
      <div className="ticket-detail__head">
        <Link className="ticket-detail__back btn-link" href="/tickets">
          ← 返回列表
        </Link>
        <a className="ticket-detail__view" href={userTicketViewUrl(ticket.token)} target="_blank" rel="noreferrer">
          打开用户进度页
        </a>
      </div>

      <div className="ticket-detail__layout">
        <TicketUserInfo ticket={ticket} />

        <aside className="ticket-detail__aside">
          <form className="ticket-panel ticket-detail__form" onSubmit={onSubmit}>
            <h2 className="ticket-panel__title">处理工单</h2>
            <label className="field">
              <span className="field__label">状态</span>
              <SelectField
                ariaLabel="工单状态"
                value={status}
                options={STATUS_OPTIONS}
                onChange={setStatus}
              />
            </label>

            <label className="field">
              <span className="field__label">处理说明</span>
              <span className="field__hint">保存后用户进度页可见</span>
              <textarea
                className="field__textarea"
                rows={5}
                maxLength={2000}
                value={publicNote}
                onChange={(event) => setPublicNote(event.target.value)}
                placeholder="写给用户的回复"
              />
            </label>

            <label className="field">
              <span className="field__label">内部备注</span>
              <span className="field__hint">仅管理台可见</span>
              <textarea
                className="field__textarea field__textarea--compact"
                rows={3}
                maxLength={4000}
                value={internalNote}
                onChange={(event) => setInternalNote(event.target.value)}
                placeholder="可选"
              />
            </label>

            {message ? <p className="form-success">{message}</p> : null}
            {error ? <p className="form-error">{error}</p> : null}

            <button className="btn-primary" type="submit" disabled={busy || deleteBusy}>
              {busy ? "保存中…" : "保存"}
            </button>
          </form>

          <div className="ticket-panel ticket-detail__danger">
            <h2 className="ticket-panel__title ticket-panel__title--danger">删除工单</h2>
            {!deleteArmed ? (
              <>
                <p className="ticket-detail__danger-lead">误提交、垃圾工单可在此永久删除，用户进度链接会一并失效。</p>
                <button
                  type="button"
                  className="btn-danger"
                  disabled={busy || deleteBusy}
                  onClick={() => setDeleteArmed(true)}
                >
                  删除这条工单
                </button>
              </>
            ) : (
              <div className="ticket-detail__danger-confirm" role="alert">
                <p className="ticket-detail__danger-warning">
                  确认要删除吗？工单内容与附件将从服务器移除，且无法恢复。
                </p>
                <div className="ticket-detail__danger-actions">
                  <button type="button" className="btn-ghost" disabled={deleteBusy} onClick={cancelDelete}>
                    取消
                  </button>
                  <button type="button" className="btn-danger" disabled={deleteBusy} onClick={() => void onConfirmDelete()}>
                    {deleteBusy ? "删除中…" : "确认删除"}
                  </button>
                </div>
              </div>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}