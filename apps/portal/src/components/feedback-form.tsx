"use client";

import { useId, useState } from "react";
import { FormField } from "@/components/ui/form-field";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { TextArea } from "@/components/ui/text-area";
import { TextField } from "@/components/ui/text-field";
import {
  FEEDBACK_ALLOWED_ATTACHMENT_ACCEPT,
  FEEDBACK_MAX_ATTACHMENT_BYTES,
  FEEDBACK_MAX_ATTACHMENTS,
  createFeedbackTicket,
  formatAttachmentSize,
  uploadFeedbackAttachments,
  type FeedbackPlatform,
  type FeedbackType,
} from "@/lib/feedback-api";

const typeOptions: Array<{ value: FeedbackType; label: string }> = [
  { value: "bug", label: "Bug" },
  { value: "feature", label: "需求" },
  { value: "other", label: "其他" },
];

const platformOptions: Array<{ value: FeedbackPlatform; label: string }> = [
  { value: "electron", label: "微端" },
  { value: "userscript", label: "浏览器" },
];

const contactTypeOptions = [
  { value: "qq" as const, label: "QQ" },
  { value: "email" as const, label: "邮箱" },
];

const ALLOWED_ATTACHMENT_TYPES = FEEDBACK_ALLOWED_ATTACHMENT_ACCEPT.split(",");

function attachmentTypeAllowed(file: File): boolean {
  const mime = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (mime && ALLOWED_ATTACHMENT_TYPES.includes(mime)) return true;
  const lower = file.name.toLowerCase();
  return /\.(png|jpe?g|webp|gif|pdf|txt)$/.test(lower);
}

function validateAttachment(file: File): string {
  if (file.size <= 0 || file.size > FEEDBACK_MAX_ATTACHMENT_BYTES) {
    return `${file.name} 超过 ${formatAttachmentSize(FEEDBACK_MAX_ATTACHMENT_BYTES)}`;
  }
  if (!attachmentTypeAllowed(file)) {
    return `${file.name} 类型不支持`;
  }
  return "";
}

export function FeedbackForm() {
  const fileInputId = useId();
  const bodyId = useId();
  const versionId = useId();
  const contactId = useId();
  const typeLabelId = useId();
  const platformLabelId = useId();
  const contactLabelId = useId();

  const [type, setType] = useState<FeedbackType>("bug");
  const [platform, setPlatform] = useState<FeedbackPlatform>("electron");
  const [clientVersion, setClientVersion] = useState("");
  const [body, setBody] = useState("");
  const [contactType, setContactType] = useState<"qq" | "email">("qq");
  const [contact, setContact] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<"idle" | "ticket" | "attachments">("idle");
  const [error, setError] = useState("");

  function addFiles(nextFiles: FileList | null) {
    if (!nextFiles?.length) return;
    setError("");
    const merged = [...files];
    for (const file of Array.from(nextFiles)) {
      const reason = validateAttachment(file);
      if (reason) {
        setError(reason);
        continue;
      }
      if (merged.some((item) => item.name === file.name && item.size === file.size)) continue;
      if (merged.length >= FEEDBACK_MAX_ATTACHMENTS) {
        setError(`最多上传 ${FEEDBACK_MAX_ATTACHMENTS} 个附件`);
        break;
      }
      merged.push(file);
    }
    setFiles(merged);
  }

  function removeFile(index: number) {
    setFiles((current) => current.filter((_, fileIndex) => fileIndex !== index));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
    setSubmitPhase("ticket");
    try {
      const result = await createFeedbackTicket({
        type,
        body,
        clientVersion,
        platform,
        contactType,
        contact: contact.trim(),
        notifyEmail: contactType === "email" && notifyEmail,
        website: "",
      });
      let uploadFailed = false;
      if (files.length) {
        setSubmitPhase("attachments");
        try {
          await uploadFeedbackAttachments(result.token, files);
        } catch (uploadError) {
          uploadFailed = true;
          console.warn(uploadError);
        }
      }
      const query = new URLSearchParams({
        token: result.token,
        new: "1",
      });
      if (uploadFailed) query.set("uploadError", "1");
      window.location.href = `/feedback/view?${query.toString()}`;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败");
      setBusy(false);
      setSubmitPhase("idle");
    }
  }

  const submitLabel =
    submitPhase === "attachments"
      ? `正在上传 ${files.length} 个附件…`
      : submitPhase === "ticket"
        ? "正在提交…"
        : "提交反馈";

  const slotsLeft = FEEDBACK_MAX_ATTACHMENTS - files.length;

  return (
    <form className="feedback-form" onSubmit={onSubmit}>
      <FormField label="类型" labelId={typeLabelId}>
        <SegmentedControl
          options={typeOptions}
          value={type}
          onChange={setType}
          stretch
          ariaLabelledBy={typeLabelId}
        />
      </FormField>

      <FormField label="描述" htmlFor={bodyId}>
        <TextArea
          id={bodyId}
          required
          minLength={8}
          maxLength={2000}
          rows={8}
          placeholder="发生了什么、你希望看到什么效果。如有复现步骤请写明。"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </FormField>

      <div className="feedback-form__grid">
        <FormField label="使用方式" labelId={platformLabelId}>
          <SegmentedControl
            options={platformOptions}
            value={platform}
            onChange={setPlatform}
            stretch
            ariaLabelledBy={platformLabelId}
          />
        </FormField>

        <FormField label="小抄版本" htmlFor={versionId}>
          <TextField
            id={versionId}
            placeholder="例如 1.6.84，不清楚可留空"
            value={clientVersion}
            onChange={(event) => setClientVersion(event.target.value)}
          />
        </FormField>
      </div>

      <FormField label="截图或附件" htmlFor={fileInputId}>
        <div className="feedback-form__upload">
          <input
            id={fileInputId}
            className="feedback-form__file"
            type="file"
            accept={FEEDBACK_ALLOWED_ATTACHMENT_ACCEPT}
            multiple
            disabled={slotsLeft <= 0}
            onChange={(event) => {
              addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <label
            className="feedback-form__upload-trigger"
            htmlFor={fileInputId}
            aria-disabled={slotsLeft <= 0}
          >
            {files.length ? "继续添加" : "选择文件"}
          </label>
          <div className="feedback-form__upload-meta">
            <p className="feedback-form__hint">
              可选，一次可多选，也可分多次添加；最多 {FEEDBACK_MAX_ATTACHMENTS} 个，单个不超过{" "}
              {formatAttachmentSize(FEEDBACK_MAX_ATTACHMENT_BYTES)}。图片、PDF 或纯文本。
            </p>
            {files.length ? (
              <p className="feedback-form__hint">
                已选 {files.length} 个
                {slotsLeft > 0 ? `，还可添加 ${slotsLeft} 个` : "，已达上限"}
              </p>
            ) : null}
          </div>
        </div>
        {files.length ? (
          <ul className="feedback-form__file-list" aria-label="已选附件">
            {files.map((file, index) => (
              <li key={`${file.name}-${file.size}-${index}`} className="feedback-form__file-item">
                <span className="feedback-form__file-name">
                  {file.name}
                  <span className="feedback-form__file-size">
                    {formatAttachmentSize(file.size)}
                  </span>
                </span>
                <button
                  type="button"
                  className="feedback-form__file-remove"
                  onClick={() => removeFile(index)}
                >
                  移除
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </FormField>

      <FormField label="联系方式" labelId={contactLabelId}>
        <div className="feedback-form__contact">
          <SegmentedControl
            options={contactTypeOptions}
            value={contactType}
            onChange={setContactType}
            stretch
            ariaLabelledBy={contactLabelId}
          />
          <TextField
            id={contactId}
            required
            inputMode={contactType === "qq" ? "numeric" : "email"}
            placeholder="用于必要时联系你"
            value={contact}
            onChange={(event) => setContact(event.target.value)}
            aria-labelledby={contactLabelId}
          />
        </div>
        {contactType === "email" ? (
          <label className="feedback-form__checkbox">
            <input
              type="checkbox"
              checked={notifyEmail}
              onChange={(event) => setNotifyEmail(event.target.checked)}
            />
            <span>状态有更新时给我发邮件（第一版暂未接入，会先记在工单里）</span>
          </label>
        ) : null}
      </FormField>

      <input
        className="feedback-form__honeypot"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        name="website"
      />

      {error ? <p className="feedback-form__error">{error}</p> : null}

      <button className="btn-primary feedback-form__submit" type="submit" disabled={busy}>
        {busy ? submitLabel : "提交反馈"}
      </button>
    </form>
  );
}