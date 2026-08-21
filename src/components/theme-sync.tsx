"use client";

import { useEffect } from "react";

/**
 * Backstop for the inline theme script in the root layout.
 *
 * Next serves its own HTML shell (`<html id="__next_error__">`) for the
 * not-found and error paths — the root layout arrives only in the RSC payload
 * and is rendered on the client, so the inline `<script>` never executes and
 * `data-theme` is absent. Without this, a user who chose dark saw those pages
 * in light.
 *
 * On every normal page the script has already run and this is a no-op. On the
 * error paths it applies the theme just after hydration; a brief flash on a 404
 * beats a permanently wrong theme.
 *
 * This is a legitimate effect: it synchronises an external system (the DOM
 * attribute the stylesheet keys off), and sets no React state.
 */
export function ThemeSync() {
  useEffect(() => {
    const root = document.documentElement;
    let stored: string | null = null;
    try {
      stored = localStorage.getItem("theme");
    } catch {
      // Storage unavailable — fall through to the OS preference.
    }

    const wanted =
      stored === "dark" || stored === "light"
        ? stored
        : window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";

    if (root.getAttribute("data-theme") !== wanted) {
      root.setAttribute("data-theme", wanted);
    }
  }, []);

  return null;
}
