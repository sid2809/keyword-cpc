"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * Container for a row of toggle buttons (tabs, segmented controls) with a
 * pill that slides to the active one.
 *
 * Mark the active child with `data-active="true"`. Each child keeps its own
 * active styling, so the server render and a no-JavaScript page look exactly
 * as before. Once the pill has measured the active child it takes over:
 * `data-pill-ready` on the container hides the child's own background
 * (globals.css), and the pill glides when the active child changes.
 * It re-measures when the container resizes. Display only; clicks and
 * selection logic stay with the children.
 */
export function PillTrack({
  children,
  className = "",
  pillClassName = "",
  ...rest
}: {
  children: ReactNode;
  className?: string;
  /** Rounding of the pill; match the buttons. */
  pillClassName?: string;
  role?: string;
  "aria-label"?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const active = el.querySelector<HTMLElement>(':scope > [data-active="true"]');
      const next = active
        ? { left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight }
        : null;
      // Runs after every render: only update when the position really changed,
      // otherwise this would re-render forever.
      setBox((prev) =>
        prev === next ||
        (prev && next && prev.left === next.left && prev.top === next.top && prev.width === next.width && prev.height === next.height)
          ? prev
          : next,
      );
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  });

  return (
    <div ref={ref} className={`relative ${className}`} data-pill-ready={box ? "" : undefined} {...rest}>
      {box && (
        <span
          aria-hidden
          className={
            "pointer-events-none absolute bg-surface shadow-card ring-1 ring-border " +
            "motion-safe:transition-[left,top,width,height] motion-safe:duration-[var(--dur-base)] motion-safe:ease-[var(--ease-out-soft)] " +
            pillClassName
          }
          style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
        />
      )}
      {children}
    </div>
  );
}
