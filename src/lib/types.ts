/**
 * Types shared between server modules and client components.
 *
 * Kept free of `server-only` and of any Node built-in import, so a client
 * component can import from here without dragging pg or node:crypto into the
 * browser bundle.
 */

export type MonthlyVolume = {
  year: number;
  /** 1-12 */
  month: number;
  searches: number;
};

export type DedupMode = "intact" | "deduped";

export type RunSettings = {
  geoTargetConstants: string[];
  language: string | null;
  network: "GOOGLE_SEARCH" | "GOOGLE_SEARCH_AND_PARTNERS";
  /** Length of the monthly volume series. Does NOT affect CPC (VERIFIED.md §3). */
  monthsBack: 3 | 6 | 12;
  includeAdultKeywords: boolean;
  dedupMode: DedupMode;
};

export type RunStatus = "queued" | "running" | "done" | "failed" | "canceled";
export type RunSource = "paste" | "csv" | "xlsx";

export type ResultRow = {
  /** What the user typed. Equals `canonical` in deduped mode. */
  submitted: string;
  canonical: string | null;
  position: number | null;
  averageCpcMicros: number | null;
  avgMonthlySearches: number | null;
  competition: string | null;
  competitionIndex: number | null;
  lowTopMicros: number | null;
  highTopMicros: number | null;
  monthlyVolumes: MonthlyVolume[] | null;
  noData: boolean;
};

export type RunSummary = {
  total: number;
  withData: number;
  noData: number;
  /**
   * PRIMARY: volume-weighted average of the HIGH top-of-page bid, in micros.
   * The low–high top-of-page band is what an advertiser actually pays to appear
   * at the top, so it leads the summary, the heat colouring and the histogram.
   * See VERIFIED.md §7.
   */
  weightedAvgHighTopMicros: number | null;
  medianHighTopMicros: number | null;
  /** Volume-weighted average of the LOW top-of-page bid — the band's floor. */
  weightedAvgLowTopMicros: number | null;
  /** SECONDARY, informational only: volume-weighted average CPC. */
  weightedAvgCpcMicros: number | null;
  medianCpcMicros: number | null;
  totalMonthlyVolume: number;
};

export type RunProgress = {
  id: string;
  status: RunStatus;
  processed: number;
  total: number;
  error: string | null;
};

export type RunListItem = {
  id: string;
  name: string | null;
  tag: string | null;
  status: RunStatus;
  processed: number;
  total: number;
  createdAt: string;
  /** PRIMARY headline metric: volume-weighted HIGH top-of-page bid. */
  weightedAvgHighTopMicros: number | null;
};
