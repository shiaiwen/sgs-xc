import type { TextareaHTMLAttributes } from "react";

function mergeClassNames(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...props} className={mergeClassNames("portal-field__textarea", className)} />;
}