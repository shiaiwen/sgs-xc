import type { Metadata } from "next";
import { Suspense } from "react";
import { FeedbackAuthorContact } from "@/components/feedback-author-contact";
import { FeedbackViewClient } from "@/components/feedback-view-client";

export const metadata: Metadata = {
  title: "反馈进度",
  description: "查看你提交的小抄反馈处理进度。",
  robots: { index: false, follow: false },
  alternates: { canonical: "/feedback/view" },
};

export default function FeedbackViewPage() {
  return (
    <main className="page-shell page-shell--narrow">
      <header className="page-shell__header">
        <h1 className="page-shell__title">反馈进度</h1>
        <p className="page-shell__lead">这条页面就是你的回执，请收藏以便稍后查看。</p>
      </header>
      <Suspense fallback={<p className="feedback-status__loading">加载中…</p>}>
        <FeedbackViewClient />
      </Suspense>
      <FeedbackAuthorContact />
    </main>
  );
}