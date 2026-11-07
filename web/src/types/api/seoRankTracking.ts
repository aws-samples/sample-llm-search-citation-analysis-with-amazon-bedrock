/**
 * Rank tracking API shapes (`${SEO_API_BASE_URL}/seo/rank-trackers...`), one-to-one with
 * `lambda/seo/seo-rank-tracking.py` (snake_case). Checked at runtime by
 * `web/src/api/seoRankTrackingDecoders.ts`.
 */

export type RankDevices = 'desktop' | 'mobile' | 'both';
export type RankDevice = 'desktop' | 'mobile';
export type RankSchedule = 'daily' | 'weekly' | 'monthly' | 'manual';
export type RankRunStatus = 'pending' | 'running' | 'completed' | 'partial' | 'failed';
export type RankPeriod = '1d' | '7d' | '30d' | '90d';
/** `not_found_unconfirmed`: missed after re-checks by a keyword that ranked before; `not_checked`: no answer. */
export type RankResultStatus = 'found' | 'not_found' | 'not_found_unconfirmed' | 'not_checked';
/** `list`: an extra keyword added by hand; `market`: a Settings keyword of the tracker's market; `group`: of its group. */
export type RankKeywordSource = 'list' | 'market' | 'group';
/** The Settings keywords a tracker checks: every active keyword of its market, or one keyword group. */
export type RankKeywordScope = 'all' | 'group';
/** `list`: a tracker stored before scopes existed, without a group (its extra keywords only). */
export type StoredRankKeywordScope = RankKeywordScope | 'list';

export interface RankRun {
  run_id: string;
  status: RankRunStatus;
  trigger: string;
  method: string;
  is_subset: boolean;
  devices: RankDevice[];
  keywords_total: number;
  keywords_checked: number;
  checked: Record<string, number>;
  error_code: string | null;
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface RankTracker {
  tracker_id: string;
  domain: string;
  market_id: string;
  devices: RankDevices;
  depth: number;
  schedule: RankSchedule;
  keyword_scope: StoredRankKeywordScope;
  group_id: string | null;
  /** The keywords a check covers (at most `max_keywords`). */
  keyword_count: number;
  /** The distinct keywords of the scope and the extra ones; more than `max_keywords` when the cap skips some. */
  scope_keyword_count: number;
  extra_keyword_count: number;
  max_keywords: number;
  is_active: boolean;
  next_check_at: string | null;
  last_checked_at: string | null;
  last_skip_reason: string | null;
  created_at: string;
  updated_at: string;
  latest_run: RankRun | null;
}

export interface RankTrackerList {
  trackers: RankTracker[];
  owned_domains: string[];
  competitor_domains: Record<string, string[]>;
}

export interface TrackedKeyword {
  keyword_id: string;
  keyword: string;
  source: RankKeywordSource;
}

export interface RankTrackerDetail {
  tracker: RankTracker;
  keywords: TrackedKeyword[];
}

/** The editable settings of a tracker; `group_id` names the group of the `group` scope. */
export interface RankTrackerSettings {
  devices: RankDevices;
  depth: number;
  schedule: RankSchedule;
  keyword_scope?: RankKeywordScope;
  group_id?: string;
}

export interface CreateRankTrackerRequest extends RankTrackerSettings {
  domain: string;
  market_id?: string;
  keywords?: string[];
}

export interface RankTrackerSaved {tracker: RankTracker;}

export interface RankEstimateRequest extends Partial<RankTrackerSettings> {
  tracker_id?: string;
  /** The market of a tracker not yet created (its `all` scope's keywords); absent = global. */
  market_id?: string;
  keywords?: string[];
}

/** The paid searches a tracker's checks start (the API also prices them; the dashboard shows no prices). */
export interface RankEstimate {
  keyword_count: number;
  /** Distinct keywords before the cap; more than `max_keywords` when a check skips some. */
  scope_keyword_count: number;
  max_keywords: number;
  pairs: number;
  checks_per_month: number;
}

export interface RankRunStarted {run: RankRun;}

export interface RankCell {
  status: RankResultStatus;
  position: number | null;
  previous_position: number | null;
  rank_absolute: number | null;
  url: string | null;
  serp_features: string[];
  checked_at: string | null;
}

export interface RankResultRow {
  keyword_id: string;
  keyword: string;
  source: RankKeywordSource;
  desktop: RankCell | null;
  mobile: RankCell | null;
}

export interface RankResults {
  tracker_id: string;
  period: RankPeriod;
  devices: RankDevice[];
  baseline_run_id: string | null;
  baseline_started_at: string | null;
  rows: RankResultRow[];
}

export interface RankHistoryPoint {
  device: RankDevice;
  checked_at: string;
  position: number | null;
  status: RankResultStatus;
  url: string | null;
}

export interface RankHistory {
  tracker_id: string;
  keyword_id: string;
  depth: number;
  points: RankHistoryPoint[];
}

export interface RankTrendPoint {
  run_id: string;
  started_at: string;
  device: RankDevice;
  total: number;
  top3: number;
  top4_10: number;
  top11_20: number;
  not_ranking: number;
  not_checked: number;
}

export interface RankTrend {
  tracker_id: string;
  days: number;
  points: RankTrendPoint[];
}

export interface RankKeywordsChanged {
  keyword_count: number;
  added?: number;
  removed?: number;
}
