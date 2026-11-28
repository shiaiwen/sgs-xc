import type { AdminTicket } from "@/lib/ticket-api";
import { contactLabel, formatTime, platformLabel } from "@/lib/ticket-api";
import { TicketAttachmentGallery } from "@/components/ticket-attachment-gallery";

type TicketUserInfoProps = {
  ticket: AdminTicket;
};

/** 用户提交侧的全部字段与附件，便于处理前一次看清。 */
export function TicketUserInfo({ ticket }: TicketUserInfoProps) {
  return (
    <div className="ticket-user-info ticket-detail__main">
      <section className="ticket-panel">
        <h2 className="ticket-panel__title">工单信息</h2>
        <dl className="ticket-info-grid">
          <div>
            <dt>类型</dt>
            <dd>{ticket.typeLabel}</dd>
          </div>
          <div>
            <dt>使用方式</dt>
            <dd>{platformLabel(ticket.platform)}</dd>
          </div>
          <div>
            <dt>QQ</dt>
            <dd>{contactLabel(ticket)}</dd>
          </div>
          <div>
            <dt>提交时间</dt>
            <dd>{formatTime(ticket.submittedAt)}</dd>
          </div>
          <div>
            <dt>最后更新</dt>
            <dd>{formatTime(ticket.updatedAt)}</dd>
          </div>
          {ticket.clientVersion ? (
            <div>
              <dt>小抄版本</dt>
              <dd>{ticket.clientVersion}</dd>
            </div>
          ) : null}
          <div>
            <dt>当前状态</dt>
            <dd>
              <span className={`status-badge status-badge--${ticket.status}`}>{ticket.statusLabel}</span>
            </dd>
          </div>
        </dl>
      </section>

      <section className="ticket-panel">
        <h2 className="ticket-panel__title">描述</h2>
        <p className="ticket-detail__body">{ticket.body}</p>
      </section>

      <section className="ticket-panel">
        <h2 className="ticket-panel__title">附件</h2>
        <TicketAttachmentGallery ticketToken={ticket.token} items={ticket.attachments} />
      </section>
    </div>
  );
}