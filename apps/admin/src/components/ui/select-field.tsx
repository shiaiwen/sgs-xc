"use client";

import { useEffect, useId, useRef, useState } from "react";

type SelectOption<T extends string> = {
  value: T;
  label: string;
};

type SelectFieldProps<T extends string> = {
  value: T;
  options: ReadonlyArray<SelectOption<T>>;
  onChange: (value: T) => void;
  ariaLabel?: string;
};

/**
 * 自定义下拉：替代原生 select，样式与输入框统一。
 */
export function SelectField<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
}: SelectFieldProps<T>) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);

  const selected = options.find((item) => item.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className={`select-field${open ? " select-field--open" : ""}`} ref={rootRef}>
      <button
        type="button"
        className="select-field__trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="select-field__value">{selected?.label}</span>
        <span className="select-field__chevron" aria-hidden="true" />
      </button>
      {open ? (
        <ul id={listId} className="select-field__menu" role="listbox" aria-label={ariaLabel}>
          {options.map((item) => {
            const active = item.value === value;
            return (
              <li key={item.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={active ? "select-field__option select-field__option--active" : "select-field__option"}
                  onClick={() => {
                    onChange(item.value);
                    setOpen(false);
                  }}
                >
                  {item.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}