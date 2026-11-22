"use client";

import { useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { FeedbackStatus } from "@/components/feedback-status";

export function FeedbackViewClient() {
  const searchParams = useSearchParams();
  const token = useMemo(() => String(searchParams.get("token") || "").trim(), [searchParams]);
  const isFresh = searchParams.get("new") === "1";

  if (!token) {
    return (
      <p className="feedback-status__error">
        链接不完整。请打开提交成功时给你的完整地址，或去
        <a href="/feedback/new"> 重新提交</a>。
      </p>
    );
  }

  return <FeedbackStatus token={token} isFresh={isFresh} />;
}