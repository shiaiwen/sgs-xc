"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { FormField } from "@/components/ui/form-field";
import { RadioGroup } from "@/components/ui/radio-group";
import { TextArea } from "@/components/ui/text-area";
import { TextField } from "@/components/ui/text-field";
import {
  FeedbackAttachmentList,
  type StagedFeedbackFile,
} from "@/components/feedback-attachment-list";
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
];

const platformOptions: Array<{ value: FeedbackPlatform; label: string }> = [
  { value: "electron", label: "微端" },
  { value: "userscript", label: "浏览器" },
];

const ALLOWED_ATTACHMENT_TYPES = FEEDBACK_ALLOWED_ATTACHMENT_ACCEPT.split(",");

function attachmentTypeAllowed(file: File): boolean {
  const mime = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (mime && ALLOWED_ATTACHMENT_TYPES.includes(mime)) return true;
  const lower = file.name.toLowerCase();
  return /\.(png|jpe?g|webp|gif|pdf|txt)$/.test(lower);
}

function isSameAttachment(left: File, right: File): boolean {
  return left.name === right.name && left.size === right.size;
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
  const contactId = useId();
  const typeLabelId = useId();
  const platformLabelId = useId();

  const [type, setType] = useState<FeedbackType>("bug");
  const [platform, setPlatform] = useState<FeedbackPlatform | "">("electron");
  const [body, setBody] = useState("");
  const [contact, setContact] = useState("");
  const [files, setFiles] = useState<StagedFeedbackFile[]>([]);
  const [busy, setBusy] = useState(false);
  const [submitPhase, setSubmitPhase] = useState<"idle" | "ticket" | "attachments">("idle");
  const [error, setError] = useState("");

  function onTypeChange(next: FeedbackType) {
    setType(next);
    if (next === "bug") {
      if (!platform) setPlatform("electron");
    } else {
      setPlatform("");
    }
  }

  function addFiles(nextFiles: FileList | null) {
    if (!nextFiles?.length) return;
    const merged = [...files];
    const duplicateNames: string[] = [];
    let validationError = "";

    for (const file of Array.from(nextFiles)) {
      const reason = validateAttachment(file);
      if (reason) {
        validationError = reason;
        continue;
      }
      // 同名同体积视为同一张图，避免列表里出现多份相同附件。
      const alreadyStaged = merged.some((item) => isSameAttachment(item.file, file));
      if (alreadyStaged) {
        if (!duplicateNames.includes(file.name)) {
          duplicateNames.push(file.name);
        }
        continue;
      }
      if (merged.length >= FEEDBACK_MAX_ATTACHMENTS) {
        setError(`最多上传 ${FEEDBACK_MAX_ATTACHMENTS} 个附件`);
        setFiles(merged);
        return;
      }
      merged.push({
        id: typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        file,
      });
    }

    setFiles(merged);

    const duplicateMessage = duplicateNames.length
      ? duplicateNames.length === 1
        ? `「${duplicateNames[0]}」已在附件列表中，未重复添加`
        : `以下文件已在列表中，未重复添加：${duplicateNames.join("、")}`
      : "";

    if (duplicateMessage && validationError) {
      setError(`${validationError}；${duplicateMessage}`);
    } else if (duplicateMessage) {
      setError(duplicateMessage);
    } else if (validationError) {
      setError(validationError);
    } else {
      setError("");
    }
  }

  function removeFile(id: string) {
    setFiles((current) => current.filter((item) => item.id !== id));
  }

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    if (type === "bug" && !platform) {
      setError("请选择使用方式");
      return;
    }
    setBusy(true);
    setSubmitPhase("ticket");
    try {
      const result = await createFeedbackTicket({
        type,
        body,
        clientVersion: "",
        platform: type === "bug" ? (platform as FeedbackPlatform) : platform,
        contactType: "qq",
        contact: contact.trim(),
        website: "",
      });
      let uploadFailed = false;
      if (files.length) {
        setSubmitPhase("attachments");
        try {
          await uploadFeedbackAttachments(
            result.token,
            files.map((item) => item.file),
          );
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
  const platformRequired = type === "bug";

  return (
    <form className="feedback-form" onSubmit={onSubmit}>
      <FormField label="类型" labelId={typeLabelId} required>
        <RadioGroup
          name="feedback-type"
          options={typeOptions}
          value={type}
          onChange={onTypeChange}
          ariaLabelledBy={typeLabelId}
        />
      </FormField>

      {type === "bug" ? (
        <p className="feedback-form__notice">
          反馈 Bug 前请先确认小抄已升级到最新版本，可到{" "}
          <Link href="/downloads">下载页</Link> 核对并更新后再提交。
        </p>
      ) : null}

      <FormField label="描述" htmlFor={bodyId} required>
        <TextArea
          id={bodyId}
          required
          rows={8}
          placeholder="发生了什么、你希望看到什么效果。如有复现步骤请写明。"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </FormField>

      <FormField label="使用方式" labelId={platformLabelId} required={platformRequired}>
        {platformRequired ? (
          <RadioGroup
            name="feedback-platform"
            options={platformOptions}
            value={platform || "electron"}
            onChange={setPlatform}
            ariaLabelledBy={platformLabelId}
          />
        ) : (
          <RadioGroup
            name="feedback-platform-optional"
            options={[
              { value: "" as const, label: "未指定" },
              ...platformOptions,
            ]}
            value={platform}
            onChange={(value) => setPlatform(value as FeedbackPlatform | "")}
            ariaLabelledBy={platformLabelId}
          />
        )}
      </FormField>

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
              {formatAttachmentSize(FEEDBACK_MAX_ATTACHMENT_BYTES)}。图片会出缩略图，点可看大图；PDF 与纯文本显示类型标记。
            </p>
            {files.length ? (
              <p className="feedback-form__hint">
                已选 {files.length} 个
                {slotsLeft > 0 ? `，还可添加 ${slotsLeft} 个` : "，已达上限"}
              </p>
            ) : null}
          </div>
        </div>
        <FeedbackAttachmentList items={files} onRemove={removeFile} />
      </FormField>

      <FormField label="QQ" htmlFor={contactId}>
        <TextField
          id={contactId}
          inputMode="numeric"
          placeholder="你的 QQ 号"
          value={contact}
          onChange={(event) => setContact(event.target.value)}
        />
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