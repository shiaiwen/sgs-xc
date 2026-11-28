import type { ReactNode } from "react";

type FormFieldProps = {
  label: string;
  children: ReactNode;
  htmlFor?: string;
  labelId?: string;
  /** 必填项在标签后显示星号 */
  required?: boolean;
};

function FieldLabel({
  label,
  required,
  htmlFor,
  id,
}: {
  label: string;
  required?: boolean;
  htmlFor?: string;
  id?: string;
}) {
  const mark = required ? (
    <span className="feedback-form__label-required" aria-hidden="true">
      *
    </span>
  ) : null;
  const content = (
    <>
      {label}
      {mark}
    </>
  );
  if (id) {
    return (
      <span className="feedback-form__label" id={id}>
        {content}
      </span>
    );
  }
  return (
    <label className="feedback-form__label" htmlFor={htmlFor}>
      {content}
    </label>
  );
}

export function FormField({ label, children, htmlFor, labelId, required }: FormFieldProps) {
  return (
    <div className="feedback-form__field">
      <FieldLabel label={label} required={required} htmlFor={htmlFor} id={labelId} />
      {children}
    </div>
  );
}