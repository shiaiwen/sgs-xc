"use client";

import { useId } from "react";

type RadioOption<T extends string> = {
  value: T;
  label: string;
};

type RadioGroupProps<T extends string> = {
  name: string;
  options: ReadonlyArray<RadioOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabelledBy?: string;
  layout?: "row" | "column";
};

/**
 * 单选组：用原生 radio，供反馈等表单在可访问性与移动端上比分段按钮更稳妥。
 */
export function RadioGroup<T extends string>({
  name,
  options,
  value,
  onChange,
  ariaLabelledBy,
  layout = "row",
}: RadioGroupProps<T>) {
  const groupId = useId();
  const rootClass = layout === "column" ? "radio-group radio-group--column" : "radio-group";

  return (
    <div
      id={groupId}
      className={rootClass}
      role="radiogroup"
      aria-labelledby={ariaLabelledBy}
    >
      {options.map((item) => {
        const inputId = `${groupId}-${item.value}`;
        const checked = item.value === value;
        return (
          <label key={item.value} className="radio-group__item" htmlFor={inputId}>
            <input
              id={inputId}
              className="radio-group__input"
              type="radio"
              name={name}
              value={item.value}
              checked={checked}
              onChange={() => onChange(item.value)}
            />
            <span className="radio-group__label">{item.label}</span>
          </label>
        );
      })}
    </div>
  );
}