import type { ReactNode } from "react";

type FormFieldProps = {
  label: string;
  children: ReactNode;
  htmlFor?: string;
  labelId?: string;
};

export function FormField({ label, children, htmlFor, labelId }: FormFieldProps) {
  return (
    <div className="feedback-form__field">
      {labelId ? (
        <span className="feedback-form__label" id={labelId}>
          {label}
        </span>
      ) : (
        <label className="feedback-form__label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
    </div>
  );
}