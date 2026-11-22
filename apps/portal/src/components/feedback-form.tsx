"use client";

import { useState } from "react";
import {
  createFeedbackTicket,
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
  { value: "userscript", label: "油猴" },
  { value: "unknown", label: "不清楚" },
];

export function FeedbackForm() {
  const [type, setType] = useState<FeedbackType>("bug");
  const [platform, setPlatform] = useState<FeedbackPlatform>("unknown");
  const [clientVersion, setClientVersion] = useState("");
  const [body, setBody] = useState("");
  const [contactType, setContactType] = useState<"qq" | "email">("qq");
  const [contact, setContact] = useState("");
  const [notifyEmail, setNotifyEmail] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError("");
    setBusy(true);
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
      window.location.href = `/feedback/view?token=${encodeURIComponent(result.token)}&new=1`;
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "提交失败");
      setBusy(false);
    }
  }

  return (
    <form className="feedback-form" onSubmit={onSubmit}>
      <div className="feedback-form__field">
        <label className="feedback-form__label" htmlFor="feedback-type">
          类型
        </label>
        <div className="segmented">
          {typeOptions.map((item) => (
            <button
              key={item.value}
              type="button"
              className={
                item.value === type
                  ? "segmented__item segmented__item--active"
                  : "segmented__item"
              }
              onClick={() => setType(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="feedback-form__field">
        <label className="feedback-form__label" htmlFor="feedback-body">
          描述
        </label>
        <textarea
          id="feedback-body"
          className="feedback-form__textarea"
          required
          minLength={8}
          maxLength={2000}
          rows={8}
          placeholder="发生了什么、你希望看到什么效果。如有复现步骤请写明。"
          value={body}
          onChange={(event) => setBody(event.target.value)}
        />
      </div>

      <div className="feedback-form__grid">
        <div className="feedback-form__field">
          <label className="feedback-form__label" htmlFor="feedback-platform">
            使用方式
          </label>
          <select
            id="feedback-platform"
            className="feedback-form__input"
            value={platform}
            onChange={(event) => setPlatform(event.target.value as FeedbackPlatform)}
          >
            {platformOptions.map((item) => (
              <option key={item.value} value={item.value}>
                {item.label}
              </option>
            ))}
          </select>
        </div>

        <div className="feedback-form__field">
          <label className="feedback-form__label" htmlFor="feedback-version">
            小抄版本
          </label>
          <input
            id="feedback-version"
            className="feedback-form__input"
            placeholder="例如 1.6.84，不清楚可留空"
            value={clientVersion}
            onChange={(event) => setClientVersion(event.target.value)}
          />
        </div>
      </div>

      <div className="feedback-form__field">
        <label className="feedback-form__label" htmlFor="feedback-contact">
          联系方式
        </label>
        <div className="feedback-form__contact">
          <div className="segmented">
            <button
              type="button"
              className={
                contactType === "qq"
                  ? "segmented__item segmented__item--active"
                  : "segmented__item"
              }
              onClick={() => setContactType("qq")}
            >
              QQ
            </button>
            <button
              type="button"
              className={
                contactType === "email"
                  ? "segmented__item segmented__item--active"
                  : "segmented__item"
              }
              onClick={() => setContactType("email")}
            >
              邮箱
            </button>
          </div>
          <input
            id="feedback-contact"
            className="feedback-form__input"
            required
            inputMode={contactType === "qq" ? "numeric" : "email"}
            placeholder={contactType === "qq" ? "用于必要时联系你" : "用于必要时联系你"}
            value={contact}
            onChange={(event) => setContact(event.target.value)}
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
      </div>

      <input
        className="feedback-form__honeypot"
        tabIndex={-1}
        autoComplete="off"
        aria-hidden="true"
        name="website"
      />

      {error ? <p className="feedback-form__error">{error}</p> : null}

      <button className="btn-primary feedback-form__submit" type="submit" disabled={busy}>
        {busy ? "提交中…" : "提交反馈"}
      </button>
    </form>
  );
}