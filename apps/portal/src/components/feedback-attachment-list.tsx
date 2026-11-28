"use client";

import { useEffect, useState } from "react";
import { formatAttachmentSize } from "@/lib/feedback-api";

export type StagedFeedbackFile = {
  id: string;
  file: File;
};

function isImageFile(file: File): boolean {
  const mime = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (mime.startsWith("image/")) return true;
  return /\.(png|jpe?g|webp|gif)$/i.test(file.name);
}

function attachmentKindLabel(file: File): string {
  const mime = String(file.type || "").split(";")[0].trim().toLowerCase();
  if (mime === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) return "PDF";
  if (mime === "text/plain" || file.name.toLowerCase().endsWith(".txt")) return "文本";
  return "文件";
}

type FeedbackAttachmentListProps = {
  items: StagedFeedbackFile[];
  onRemove: (id: string) => void;
};

/**
 * 展示待上传附件：图片用本地 object URL 出缩略图，点开可在新标签看大图。
 */
export function FeedbackAttachmentList({ items, onRemove }: FeedbackAttachmentListProps) {
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});
  useEffect(() => {
    const urls: Record<string, string> = {};
    for (const item of items) {
      if (isImageFile(item.file)) {
        urls[item.id] = URL.createObjectURL(item.file);
      }
    }
    setPreviewUrls(urls);
    return () => {
      for (const url of Object.values(urls)) {
        URL.revokeObjectURL(url);
      }
    };
  }, [items]);

  if (!items.length) return null;

  return (
    <ul className="feedback-form__file-list" aria-label="已选附件">
      {items.map((item) => {
        const previewUrl = previewUrls[item.id];
        const image = Boolean(previewUrl);
        return (
          <li key={item.id} className="feedback-form__file-item">
            <div className="feedback-form__file-preview">
              {image ? (
                <a
                  className="feedback-form__file-thumb-link"
                  href={previewUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="在新标签页查看原图"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    className="feedback-form__file-thumb"
                    src={previewUrl}
                    alt={item.file.name}
                  />
                </a>
              ) : (
                <div className="feedback-form__file-thumb feedback-form__file-thumb--placeholder">
                  {attachmentKindLabel(item.file)}
                </div>
              )}
            </div>
            <div className="feedback-form__file-meta">
              <p className="feedback-form__file-name" title={item.file.name}>
                {item.file.name}
              </p>
              <p className="feedback-form__file-size">{formatAttachmentSize(item.file.size)}</p>
            </div>
            <button
              type="button"
              className="feedback-form__file-remove"
              onClick={() => onRemove(item.id)}
            >
              移除
            </button>
          </li>
        );
      })}
    </ul>
  );
}