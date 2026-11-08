/**
 * The 2.45.0 export service contract (`lambda/shared/export_contract.py`).
 *
 * Every data view's "Export all" button posts `{view, params, format}` to
 * `POST /api/exports`; the job runs until the whole file is written and the
 * Exports page lists it with a download link once `ready`.
 *
 * `@public` marks contract exports the dashboard does not read yet (track T3
 * builds the Exports page and the button on them); knip skips them until then.
 */

/**
 * One id per row source of the views matrix (S1–S27); `lambda/shared/test_export_contract.py`
 * pins the same ids as the API's `EXPORT_VIEWS`.
 */
export const EXPORT_VIEWS = [
  'brand-appearances',
  'brand-leaderboard',
  'brand-mention-summary',
  'brand-trends',
  'sources',
  'keyword-visibility',
  'trend-periods',
  'keyword-trends',
  'engines',
  'persona-rankings',
  'sentiment-examples',
  'citations',
  'url-breakdown',
  'crawl-history',
  'searches',
  'citation-gaps',
  'gap-keyword-summaries',
  'prompt-insights',
  'recommendations',
  'competitor-gap',
  'group-kpis',
  'report-insights',
  'content-ideas',
  'content-history',
  'keyword-research',
  'alerts',
  'config-lists',
  'seo-geo',
  'seo-rank-tracking',
  'seo-site-audit',
  'seo-lighthouse',
  'seo-local',
  'seo-keyword-explorer',
  'seo-domain',
  'seo-backlinks',
  'seo-domain-tables',
] as const;

/** @public */
export type ExportView = (typeof EXPORT_VIEWS)[number];

/** @public */
export type ExportFormat = 'csv' | 'xlsx';

/** @public */
export type ExportStatus = 'queued' | 'running' | 'ready' | 'failed' | 'cancelled';

/**
 * An export as `GET /api/exports` and `GET /api/exports/{id}` answer it.
 * @public
 */
export interface ExportSummary {
  export_id: string;
  view: ExportView;
  /** The view's on-screen query parameters, without the paging ones. */
  params: Record<string, string>;
  format: ExportFormat;
  status: ExportStatus;
  created_at: string;
  updated_at: string;
  rows: number;
  /** XLSX text cells cut to Excel's 32,767 characters (each ends with a visible marker; the CSV keeps them whole). */
  truncated_cells: number;
  bytes: number;
  filename: string;
  /** The owner has seen that it finished (`POST /api/exports/{id}/seen`). */
  notified: boolean;
  /** Why a `failed` export stopped. */
  error?: string;
  /** Presigned GET, only on a `ready` export read by id; valid until `download_expires_at`. */
  download_url?: string;
  download_expires_at?: string;
}

/**
 * `GET /api/exports`: the caller's own exports, newest first.
 * @public
 */
export interface ExportsListResponse {
  exports: ExportSummary[];
  /** The next page; `null` or absent on the last. */
  next_token?: string | null;
}
