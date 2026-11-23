import type { InputHTMLAttributes } from "react";

function mergeClassNames(...parts: Array<string | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...props} className={mergeClassNames("portal-field__input", className)} />;
}