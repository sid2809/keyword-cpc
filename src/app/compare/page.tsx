import Link from "next/link";
import { redirect } from "next/navigation";
import { GitCompareArrows } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { BTN_PRIMARY, Card, EmptyState, PageHeader, btn } from "@/components/ui";
import { getSession } from "@/lib/session";
import { compareRuns } from "@/lib/compare";
import { formatCompact, formatDateTime, formatInt, formatMicros } from "@/lib/format";

/** Compare two runs — PLAN.md §6 screen 3. */
export default async function ComparePage({ searchParams }: PageProps<"/compare">) {
  if (!(await getSession())) redirect("/login");

  const params = await searchParams;
  const aId = typeof params.a === "string" ? params.a : null;
  const bId = typeof params.b === "string" ? params.b : null;

  // ?page=N — whole numbers from 1; anything else means page 1.
  const pageParam = typeof params.page === "string" && /^\d+$/.test(params.page) ? Number(params.page) : 1;

  const result = aId && bId && aId !== bId ? await compareRuns(aId, bId, { page: pageParam }) : null;

  if (!result) {
    return (
      <AppShell>
        <PageHeader title="Compare runs" description="Side-by-side change in top-of-page bids between two runs." />
        <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-10">
          <Card>
            <EmptyState
              icon={<GitCompareArrows size={18} />}
              title="Pick two runs to compare"
              body={
                aId && bId
                  ? "Those two runs could not be loaded — one may have been deleted, or you picked the same run twice."
                  : "On the Runs page, tick two finished runs and choose Compare. Keywords are matched on Google's canonical form, so “car” and “cars” line up."
              }
              action={
                <Link href="/runs" className={BTN_PRIMARY}>
                  Go to Runs
                </Link>
              }
            />
          </Card>
        </main>
      </AppShell>
    );
  }

  const { a, b, rows } = result;
  const summaryDelta =
    a.summary.weightedAvgHighTopMicros !== null && b.summary.weightedAvgHighTopMicros !== null
      ? b.summary.weightedAvgHighTopMicros - a.summary.weightedAvgHighTopMicros
      : null;

  return (
    <AppShell>
      <PageHeader
        breadcrumb={
          <nav aria-label="Breadcrumb" className="text-xs text-text-secondary">
            <Link href="/runs" className="font-medium hover:text-text">
              All runs
            </Link>
            <span className="mx-1.5 text-text-muted" aria-hidden>
              /
            </span>
            <span className="text-text-muted">Compare</span>
          </nav>
        }
        title={
          <>
            <Link href={`/runs/${a.id}`} className="hover:text-accent">{a.name}</Link>
            <span className="mx-2 text-text-muted">→</span>
            <Link href={`/runs/${b.id}`} className="hover:text-accent">{b.name}</Link>
          </>
        }
        description="Side-by-side change in top-of-page bids between two runs."
      />
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 pt-6 pb-10">
        <Card className="mb-4 p-5">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3 lg:grid-cols-5">
            <Stat label="In both runs" value={formatInt(result.inBoth)} />
            <Stat label={`Only in ${a.name}`} value={formatInt(result.onlyA)} />
            <Stat label={`Only in ${b.name}`} value={formatInt(result.onlyB)} />
            <Stat
              label="Wtd top-of-page"
              value={`${formatMicros(a.summary.weightedAvgHighTopMicros)} → ${formatMicros(b.summary.weightedAvgHighTopMicros)}`}
            />
            <Stat
              label="Change"
              value={summaryDelta === null ? "—" : `${summaryDelta > 0 ? "↑" : summaryDelta < 0 ? "↓" : ""} ${formatMicros(Math.abs(summaryDelta))}`}
              color={summaryDelta === null || summaryDelta === 0 ? undefined : summaryDelta > 0 ? "var(--heat-red)" : "var(--heat-green)"}
            />
          </dl>
          <p className="mt-4 border-t border-border pt-3 text-xs text-text-muted">
            {formatDateTime(a.createdAt)} → {formatDateTime(b.createdAt)} · matched on Google&rsquo;s
            canonical keyword · a rise in what you must bid is shown red
          </p>
        </Card>

        <Card className="overflow-hidden">
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full border-collapse text-left">
              <thead className="sticky top-0 z-10 bg-surface">
                <tr className="border-b border-border">
                  <th className="px-4 py-2 text-xs font-medium text-text-secondary">Keyword</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">
                    {a.name} top-of-page
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">
                    {b.name} top-of-page
                  </th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">Change</th>
                  <th className="px-4 py-2 text-right text-xs font-medium text-text-secondary">Volume</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr
                    key={r.keyword}
                    className={
                      "border-b border-border last:border-0 hover:bg-accent-soft/40 " +
                      (r.presence !== "both" ? "opacity-60" : "")
                    }
                  >
                    <td className="px-4 py-2 text-sm text-text">
                      <span className="block max-w-[300px] truncate" title={r.keyword}>
                        {r.keyword}
                      </span>
                      {r.presence !== "both" && (
                        <span className="text-xs text-text-muted">
                          only in {r.presence === "only-a" ? a.name : b.name}
                        </span>
                      )}
                    </td>
                    <td className="num px-4 py-2 text-right text-text-secondary">{formatMicros(r.aHighTop)}</td>
                    <td className="num px-4 py-2 text-right text-text-secondary">{formatMicros(r.bHighTop)}</td>
                    <td className="num px-4 py-2 text-right">
                      {r.highTopDelta === null ? (
                        <span className="text-text-muted">—</span>
                      ) : r.highTopDelta === 0 ? (
                        <span className="text-text-muted">no change</span>
                      ) : (
                        <span style={{ color: r.highTopDelta > 0 ? "var(--heat-red)" : "var(--heat-green)" }}>
                          {r.highTopDelta > 0 ? "↑" : "↓"} {formatMicros(Math.abs(r.highTopDelta))}
                        </span>
                      )}
                    </td>
                    <td className="num px-4 py-2 text-right text-text-secondary">
                      {formatCompact(r.aVolume)} → {formatCompact(r.bVolume)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ComparePagination
            aId={a.id}
            bId={b.id}
            page={result.page}
            pageSize={result.pageSize}
            total={result.total}
          />
        </Card>
      </main>
    </AppShell>
  );
}

/**
 * Page links for the comparison table. Plain links (no client code): each page
 * is its own URL, so it can be bookmarked and the back button works.
 */
function ComparePagination({
  aId,
  bId,
  page,
  pageSize,
  total,
}: {
  aId: string;
  bId: string;
  page: number;
  pageSize: number;
  total: number;
}) {
  if (total === 0) return null;
  const lastPage = Math.max(1, Math.ceil(total / pageSize));
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  const href = (p: number) => `/compare?a=${aId}&b=${bId}&page=${p}`;

  const link = (target: number, label: string, text: string, disabled: boolean) =>
    disabled ? (
      <span aria-disabled="true" className={`${btn("secondary", "icon")} pointer-events-none opacity-50`}>
        {text}
      </span>
    ) : (
      <Link href={href(target)} aria-label={label} className={btn("secondary", "icon")}>
        {text}
      </Link>
    );

  return (
    <nav
      aria-label="Comparison pages"
      className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2.5"
    >
      <p className="text-xs text-text-secondary">
        Rows {formatInt(first)}–{formatInt(last)} of {formatInt(total)}
      </p>
      <div className="flex items-center gap-2">
        {link(1, "First page", "«", page <= 1)}
        {link(page - 1, "Previous page", "‹", page <= 1)}
        <span className="text-xs text-text-secondary">
          Page {formatInt(page)} of {formatInt(lastPage)}
        </span>
        {link(page + 1, "Next page", "›", page >= lastPage)}
        {link(lastPage, "Last page", "»", page >= lastPage)}
      </div>
    </nav>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-text-secondary" title={label}>
        {label}
      </dt>
      <dd className="num mt-0.5 text-[15px] text-text" style={color ? { color } : undefined}>
        {value}
      </dd>
    </div>
  );
}
