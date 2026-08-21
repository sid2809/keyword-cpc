"use client";

import { useEffect } from "react";
import Link from "next/link";
import { BTN_PRIMARY, BTN_SECONDARY, Card } from "@/components/ui";

/**
 * Route-level error boundary. `reset()` re-renders the segment, which is enough
 * for a transient database or API blip.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[app] route error:", error);
  }, [error]);

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <Card className="w-full max-w-lg p-6">
        <h1 className="text-sm font-semibold text-heat-red">Something went wrong</h1>
        <p className="mt-1 text-sm text-text-secondary">
          The page failed to load. Trying again often fixes it — if it doesn&rsquo;t, check that
          Postgres is running and that your Google Ads credentials are still valid on the Settings
          page.
        </p>
        <pre className="mt-3 overflow-x-auto rounded-[var(--radius-control)] border border-border p-3 text-xs text-text-secondary">
          {error.message}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <div className="mt-4 flex gap-2">
          <button type="button" onClick={reset} className={BTN_PRIMARY}>
            Try again
          </button>
          <Link href="/runs" className={BTN_SECONDARY}>
            Go to Runs
          </Link>
        </div>
      </Card>
    </main>
  );
}
