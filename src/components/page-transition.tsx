"use client";

import { usePathname } from "next/navigation";
import { ViewTransition, type ReactNode } from "react";

/**
 * Animates page content when the user moves to another page.
 *
 * A fixed `name` plus a pathname `key` makes React treat the old and new page
 * content as a shared pair (the pattern in Next's view-transitions guide,
 * "Crossfade content"), animated with the `page` class (globals.css): old
 * fades out, new fades in and rises 6px. A plain enter/exit pair did not fire
 * on page changes in testing, so the shared pair is used instead.
 * Query-string changes on the same page (results paging, filters) keep the
 * same key and do not animate; `default="none"` keeps refreshes still.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ViewTransition key={pathname} name="page-content" share="page" default="none">
      <div className="flex min-w-0 flex-1 flex-col">{children}</div>
    </ViewTransition>
  );
}
