import { useLayoutEffect, useRef, type ChangeEvent } from "react";

const MIN_HEIGHT = 44;
const MAX_HEIGHT = 320;

export function AutoGrowTextarea({
  value,
  onChange,
  maxLength = 2000,
}: {
  value: string;
  onChange: (value: string) => void;
  maxLength?: number;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    field.style.height = "auto";
    const height = field.scrollHeight;
    field.style.height = `${Math.min(Math.max(height, MIN_HEIGHT), MAX_HEIGHT)}px`;
    field.style.overflowY = height > MAX_HEIGHT ? "auto" : "hidden";
  }, [value]);
  return (
    <textarea
      ref={ref}
      rows={1}
      maxLength={maxLength}
      value={value}
      onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
        onChange(event.target.value)
      }
    />
  );
}
