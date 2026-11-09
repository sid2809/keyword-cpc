"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Display-only count-up for an already formatted value ("₹44.96", "1,22,500",
 * "2907.4M"). It never changes what the value IS:
 *
 * - The server renders the exact final text, and screen readers always read
 *   that text (sr-only). Only the visible copy animates.
 * - The animation counts the numeric part from 0 up to the final number, then
 *   shows the original string verbatim, so the last frame is identical.
 * - Values without a number ("—") and users with "reduce motion" see the
 *   final text at once. It animates on first mount only; later changes
 *   swap straight to the new value.
 *
 * Intermediate frames copy the source's decimals and grouping (en-IN, the
 * app's locale: "1,22,500"), so digits don't jump between styles mid-count.
 */

const DURATION_MS = 700;
const NUMBER = /^(\D*?)(\d[\d,]*(?:\.\d+)?)(.*)$/;

function parse(value: string) {
  const m = NUMBER.exec(value);
  if (!m) return null;
  const [, prefix, digits, suffix] = m;
  const n = Number(digits.replace(/,/g, ""));
  if (!Number.isFinite(n)) return null;
  const decimals = digits.includes(".") ? digits.split(".")[1].length : 0;
  const fmt = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
    useGrouping: digits.includes(","),
  });
  return { n, render: (x: number) => `${prefix}${fmt.format(x)}${suffix}` };
}

export function CountUp({ value, className = "" }: { value: string; className?: string }) {
  const [display, setDisplay] = useState(value);
  const [phase, setPhase] = useState<"pending" | "running" | "done">("pending");
  const animated = useRef(false);

  useEffect(() => {
    const parsed = parse(value);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;

    if (animated.current || !parsed || reduce || parsed.n === 0) {
      frame = requestAnimationFrame(() => {
        setDisplay(value);
        setPhase("done");
      });
      return () => cancelAnimationFrame(frame);
    }

    animated.current = true;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      if (t < 1) {
        setDisplay(parsed.render(parsed.n * eased));
        setPhase("running");
        frame = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
        setPhase("done");
      }
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      setDisplay(value);
    };
  }, [value]);

  return (
    <span className={className}>
      <span aria-hidden data-countup={phase}>
        {display}
      </span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
