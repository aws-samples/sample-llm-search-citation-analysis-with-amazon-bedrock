/**
 * Central type exports - re-exports all types from domain and api subfolders.
 */

// Domain types (business entities)
export * from './domain';

// API response types
export * from './api/brandConfig';
export * from './api/responses';

/**
 * Navigation tab identifiers for the dashboard.
 *
 * `reports` is the marker for any path that lives under `/reports/*`. Each
 * individual report (executive summary, keyword deep dive, etc.) shares this
 * tab id so the sidebar's `Reporting` section stays highlighted regardless of
 * which sub-report the user is currently viewing. The actual sub-routing for
 * `/reports/...` is handled by `ReportsRouter`, not by `TabContent`.
 */
export type TabType = 
  | 'dashboard' 
  | 'brands' 
  | 'citations'
  | 'visibility'
  | 'prompt-insights'
  | 'citation-gaps'
  | 'recommendations'
  | 'execution' 
  | 'schedule'
  | 'keyword-research'
  | 'content-studio'
  | 'reports'
  | 'settings'
  | 'searches'
  | 'raw-responses';
