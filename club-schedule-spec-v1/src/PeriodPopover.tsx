import {
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent,
  type SetStateAction,
} from "react";
import { CaretDown, Check } from "@phosphor-icons/react";

type Period = {
  campus_id: "omiya" | "hirakata";
  period_number: number;
  start_time: string;
  end_time: string;
};
const campusLabel = { omiya: "大宮", hirakata: "枚方" };

export function PeriodPopover({
  periods,
  selected,
  onChange,
  common,
}: {
  periods: Period[];
  selected: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  common: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [placement, setPlacement] = useState<"top" | "bottom">("bottom");
  const container = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const keyFor = (period: Period) =>
    `${period.campus_id}:${period.period_number}`;
  const choices = periods.filter((period) => selected.includes(keyFor(period)));
  const summary = choices.length
    ? choices
        .map(
          (period) =>
            `${common ? campusLabel[period.campus_id] : ""}${period.period_number}限`,
        )
        .join("、")
    : "未選択";
  useEffect(() => {
    if (open) items.current[focusIndex]?.focus();
  }, [open, focusIndex]);
  useEffect(() => {
    if (!open) return;
    const onOutside = (event: PointerEvent) => {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, [open]);
  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };
  const openAt = (index: number) => {
    const bounds = container.current?.getBoundingClientRect();
    setPlacement(
      bounds && window.innerHeight - bounds.bottom < 260 && bounds.top > 260
        ? "top"
        : "bottom",
    );
    setFocusIndex(index);
    setOpen(true);
  };
  const toggleAt = (index: number) => {
    const period = periods[index];
    if (!period) return;
    const key = keyFor(period);
    onChange((current) =>
      current.includes(key)
        ? current.filter((value) => value !== key)
        : [...current, key],
    );
    setFocusIndex(index);
  };
  const onKeys = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === "Tab") {
      close(false);
      return;
    }
    if (event.key === " " || event.key === "Enter") {
      event.preventDefault();
      toggleAt(focusIndex);
      return;
    }
    if (
      !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) ||
      !periods.length
    )
      return;
    event.preventDefault();
    setFocusIndex(
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? periods.length - 1
          : (focusIndex +
              (event.key === "ArrowDown" ? 1 : -1) +
              periods.length) %
            periods.length,
    );
  };
  return (
    <div className="period-popover" data-placement={placement} ref={container}>
      <button
        type="button"
        ref={trigger}
        className="period-trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? "period-options" : undefined}
        onClick={() => {
          if (open) close(false);
          else openAt(0);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            openAt(event.key === "ArrowDown" ? 0 : periods.length - 1);
          }
        }}
      >
        <span>
          <strong>参加する時限</strong>
          <span className="period-summary">{summary}</span>
        </span>
        <CaretDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div
          id="period-options"
          className="period-menu"
          role="menu"
          aria-label="参加する時限"
          onKeyDown={onKeys}
        >
          {periods.length ? (
            periods.map((period, index) => {
              const key = keyFor(period),
                checked = selected.includes(key);
              return (
                <button
                  key={key}
                  type="button"
                  role="menuitemcheckbox"
                  aria-checked={checked}
                  tabIndex={-1}
                  ref={(node) => {
                    items.current[index] = node;
                  }}
                  onClick={() => toggleAt(index)}
                >
                  <span>
                    {common && `${campusLabel[period.campus_id]} `}
                    {period.period_number}限
                  </span>
                  <span className="period-hours">
                    {period.start_time}〜{period.end_time}
                  </span>
                  {checked && (
                    <Check size={17} weight="bold" aria-hidden="true" />
                  )}
                </button>
              );
            })
          ) : (
            <p className="muted">選べる時限はありません。</p>
          )}
        </div>
      )}
    </div>
  );
}
