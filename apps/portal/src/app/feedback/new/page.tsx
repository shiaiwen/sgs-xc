import type { Metadata } from "next";
import { FeedbackAuthorContact } from "@/components/feedback-author-contact";
import { FeedbackForm } from "@/components/feedback-form";

export const metadata: Metadata = {
  title: "反馈与建议",
  description: "提交小抄 Bug 或功能需求，提交后可收藏专属链接查看处理进度。",
  alternates: { canonical: "/feedback/new" },
};

export default function FeedbackNewPage() {
  return (
    <main className="page-shell page-shell--narrow">
      <header className="page-shell__header">
        <h1 className="page-shell__title">反馈与建议</h1>
        <p className="page-shell__lead">
          提交后会给你一条专属链接，收藏后随时查看进度。下面也会让你留下 QQ 或邮箱，方便必要时回找你。
        </p>
      </header>
      <FeedbackForm />
      <FeedbackAuthorContact />
    </main>
  );
}