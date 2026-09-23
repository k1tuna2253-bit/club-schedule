import { useRef } from "react";

export function ChoiceGroup<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  return (
    <div className="choice-field">
      <span className="choice-label" id={`choice-${label}`}>
        {label}
      </span>
      <div
        className="choice-group"
        role="radiogroup"
        aria-labelledby={`choice-${label}`}
        ref={ref}
      >
        {options.map((option, index) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={value === option.value}
            tabIndex={value === option.value ? 0 : -1}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight" || event.key === "ArrowDown")
                next = (index + 1) % options.length;
              else if (event.key === "ArrowLeft" || event.key === "ArrowUp")
                next = (index + options.length - 1) % options.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = options.length - 1;
              else return;
              event.preventDefault();
              onChange(options[next].value);
              ref.current
                ?.querySelectorAll<HTMLButtonElement>('[role="radio"]')
                [next]?.focus();
            }}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}
