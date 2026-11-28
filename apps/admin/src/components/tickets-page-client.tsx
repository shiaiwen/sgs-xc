"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { TicketTable } from "@/components/ticket-table";
import type { AdminTicket } from "@/lib/ticket-api";
import { clearSessionToken, fetchAdminTickets, readSessionToken } from "@/lib/ticket-api";

/** 工单中心列表页：拉取工单并交给表格分页展示。 */
export function TicketsPageClient() {
  const router = useRouter();
  const [tickets, setTickets] = useState<AdminTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const session = readSessionToken();
    if (!session) {
      router.replace("/login");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const next = await fetchAdminTickets(session);
      setTickets(next);
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "加载失败";
      if (message === "登录已失效") {
        clearSessionToken();
        router.replace("/login");
        return;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <header className="page-head">
        <h1 className="page-head__title">工单列表</h1>
        <p className="page-head__desc">按更新时间排序，点击处理可回复用户。</p>
      </header>
      {error ? <p className="form-error">{error}</p> : null}
      <TicketTable tickets={tickets} loading={loading} onRefresh={() => void load()} />
    </div>
  );
}