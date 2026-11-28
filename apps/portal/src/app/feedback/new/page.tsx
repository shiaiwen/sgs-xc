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
          每一条反馈都在帮小抄变好。提交后会得到专属进度页，收藏链接随时可看处理进展；需要补充细节或着急说明，用本页下方 QQ 找我就好。
        </p>
      </header>
      <FeedbackForm />
      <FeedbackAuthorContact />
    </main>
  );
}