import { type MouseEvent, type ReactNode } from "react";

/** Dismiss on click, after pointerup, so an unmounted backdrop cannot retarget that click. */
export function DialogLayer({
  className,
  onClose,
  children,
}: {
  className: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const close = (event: MouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
    if (event.target !== event.currentTarget) return;
    onClose();
  };
  return (
    <div
      className={className}
      onPointerDown={(event) => event.stopPropagation()}
      onPointerUp={(event) => event.stopPropagation()}
      onClick={close}
    >
      {children}
    </div>
  );
}
