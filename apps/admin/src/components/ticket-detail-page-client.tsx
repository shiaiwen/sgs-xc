"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { TicketDetailForm } from "@/components/ticket-detail-form";
import type { AdminTicket } from "@/lib/ticket-api";
import { clearSessionToken, fetchAdminTickets, readSessionToken } from "@/lib/ticket-api";

type TicketDetailPageClientProps = {
  token: string;
};

/** 按 token 从列表数据中定位工单并展示处理表单。 */
export function TicketDetailPageClient({ token }: TicketDetailPageClientProps) {
  const router = useRouter();
  const [ticket, setTicket] = useState<AdminTicket | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const session = readSessionToken();
    if (!session) {
      router.replace("/login");
      return;
    }
    let active = true;
    fetchAdminTickets(session)
      .then((list) => {
        if (!active) return;
        const found = list.find((item) => item.token === token) || null;
        if (!found) {
          setError("找不到这条工单");
        } else {
          setTicket(found);
        }
      })
      .catch((loadError) => {
        if (!active) return;
        const message = loadError instanceof Error ? loadError.message : "加载失败";
        if (message === "登录已失效") {
          clearSessionToken();
          router.replace("/login");
          return;
        }
        setError(message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [token, router]);

  if (loading) {
    return <p className="console-loading">加载工单…</p>;
  }

  if (error) {
    return <p className="form-error">{error}</p>;
  }

  if (!ticket) {
    return <p className="form-error">找不到这条工单</p>;
  }

  return (
    <div className="ticket-detail-page">
      <TicketDetailForm ticket={ticket} />
    </div>
  );
}