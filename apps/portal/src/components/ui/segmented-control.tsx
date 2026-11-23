"use client";

type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

type SegmentedControlProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (value: T) => void;
  stretch?: boolean;
  ariaLabelledBy?: string;
  ariaLabel?: string;
  role?: "group" | "tablist";
};

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  stretch = false,
  ariaLabelledBy,
  ariaLabel,
  role = "group",
}: SegmentedControlProps<T>) {
  const rootClass = stretch ? "segmented segmented--stretch" : "segmented";
  return (
    <div
      className={rootClass}
      role={role}
      aria-labelledby={ariaLabelledBy}
      aria-label={ariaLabel}
    >
      {options.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role={role === "tablist" ? "tab" : undefined}
            aria-selected={role === "tablist" ? selected : undefined}
            className={selected ? "segmented__item segmented__item--active" : "segmented__item"}
            onClick={() => onChange(item.value)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}