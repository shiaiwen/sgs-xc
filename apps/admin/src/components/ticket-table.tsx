"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import type { AdminTicket } from "@/lib/ticket-api";
import { formatTime } from "@/lib/ticket-api";

const PAGE_SIZE = 15;

function excerpt(text: string, max = 48): string {
  const value = text.trim();
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

type TicketTableProps = {
  tickets: AdminTicket[];
  loading?: boolean;
  onRefresh: () => void;
};

/** 工单列表表格与分页。 */
export function TicketTable({ tickets, loading = false, onRefresh }: TicketTableProps) {
  const [page, setPage] = useState(1);

  const pageCount = Math.max(1, Math.ceil(tickets.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount);

  const pageItems = useMemo(() => {
    const start = (safePage - 1) * PAGE_SIZE;
    return tickets.slice(start, start + PAGE_SIZE);
  }, [tickets, safePage]);

  return (
    <div className="ticket-list">
      <div className="ticket-list__toolbar">
        <p className="ticket-list__count">共 {tickets.length} 条</p>
        <button type="button" className="btn-ghost" onClick={onRefresh} disabled={loading}>
          {loading ? "刷新中…" : "刷新"}
        </button>
      </div>

      <div className="ticket-table-card">
        <div className="ticket-table-wrap">
        <table className="ticket-table">
          <thead>
            <tr>
              <th>状态</th>
              <th>类型</th>
              <th>描述摘要</th>
              <th>联系方式</th>
              <th>最后更新</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {pageItems.length ? (
              pageItems.map((item) => (
                <tr key={item.token}>
                  <td>
                    <span className={`status-badge status-badge--${item.status}`}>{item.statusLabel}</span>
                  </td>
                  <td>{item.typeLabel}</td>
                  <td className="ticket-table__body">{excerpt(item.body)}</td>
                  <td>
                    {item.contact ? (item.contactType === "qq" ? `QQ ${item.contact}` : item.contact) : "—"}
                  </td>
                  <td>{formatTime(item.updatedAt)}</td>
                  <td>
                    <Link className="btn-link" href={`/tickets/${encodeURIComponent(item.token)}`}>
                      处理
                    </Link>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={6} className="ticket-table__empty">
                  暂无工单
                </td>
              </tr>
            )}
          </tbody>
        </table>
        </div>

        {tickets.length > PAGE_SIZE ? (
          <SelectedPagination
            page={safePage}
            pageCount={pageCount}
            onPageChange={setPage}
          />
        ) : null}
      </div>
    </div>
  );
}

function SelectedPagination({
  page,
  pageCount,
  onPageChange,
}: {
  page: number;
  pageCount: number;
  onPageChange: (value: number) => void;
}) {
  return (
    <nav className="pagination" aria-label="工单分页">
      <button
        type="button"
        className="btn-ghost"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
      >
        上一页
      </button>
      <span className="pagination__info">
        第 {page} / {pageCount} 页
      </span>
      <button
        type="button"
        className="btn-ghost"
        disabled={page >= pageCount}
        onClick={() => onPageChange(page + 1)}
      >
        下一页
      </button>
    </nav>
  );
}