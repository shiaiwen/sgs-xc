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
        <p className="page-shell__lead">
          谢谢你的反馈。本页是你的专属回执，收藏或保存链接即可随时查看；有进展会更新在下方状态里。想补充说明，欢迎用页面底部的 QQ 联系我。
        </p>
      </header>
      <Suspense fallback={<p className="feedback-status__loading">加载中…</p>}>
        <FeedbackViewClient />
      </Suspense>
      <FeedbackAuthorContact />
    </main>
  );
}