"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { clearSessionToken, fetchAdminTickets, readSessionToken } from "@/lib/ticket-api";

/** 控制台页面：校验会话，无效则回登录页。 */
export function AuthGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const token = readSessionToken();
    if (!token) {
      router.replace("/login");
      return;
    }
    let active = true;
    fetchAdminTickets(token)
      .then(() => {
        if (active) setReady(true);
      })
      .catch(() => {
        clearSessionToken();
        if (active) router.replace("/login");
      });
    return () => {
      active = false;
    };
  }, [router]);

  if (!ready) {
    return <p className="console-loading">加载中…</p>;
  }

  return children;
}