import type { AdminAttachment } from "@/lib/ticket-api";
import {
  attachmentIsImage,
  formatFileSize,
  resolveAttachmentUrl,
} from "@/lib/ticket-api";

type TicketAttachmentGalleryProps = {
  ticketToken: string;
  items: AdminAttachment[];
};

/** 附件缩略图：图片直接预览，其它类型给下载链接。 */
export function TicketAttachmentGallery({ ticketToken, items }: TicketAttachmentGalleryProps) {
  if (!items.length) {
    return <p className="ticket-panel__empty">用户未上传附件</p>;
  }

  return (
    <ul className="ticket-attachments">
      {items.map((item) => {
        const expired = Boolean(item.deletedAt);
        const href = expired ? "" : resolveAttachmentUrl(ticketToken, item.id);
        const image = !expired && attachmentIsImage(item);

        return (
          <li key={item.id} className="ticket-attachments__item">
            {image ? (
              <a className="ticket-attachments__thumb-link" href={href} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  className="ticket-attachments__thumb"
                  src={href}
                  alt={item.name}
                  loading="lazy"
                />
              </a>
            ) : (
              <div className="ticket-attachments__thumb ticket-attachments__thumb--file">
                {expired ? "已清理" : item.name.split(".").pop()?.toUpperCase() || "文件"}
              </div>
            )}
            <div className="ticket-attachments__meta">
              {expired || !href ? (
                <span className="ticket-attachments__name">{item.name}</span>
              ) : (
                <a className="ticket-attachments__name" href={href} target="_blank" rel="noreferrer">
                  {item.name}
                </a>
              )}
              <span className="ticket-attachments__size">
                {expired ? "已过期" : formatFileSize(item.size)}
              </span>
            </div>
          </li>
        );
      })}
    </ul>
  );
}