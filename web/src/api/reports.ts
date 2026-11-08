/**
 * Reports API response types.
 *
 * Backed by the consolidated stats-insights Lambda. The endpoints return
 * pre-aggregated payloads tailored for the print reports —
 * /reports/overview composes data that would otherwise require multiple
 * round-trips (trends + recommendations) to assemble client-side.
 * /reports/competitor returns the per-competitor rollup (outranked
 * keywords, exclusive citation sources, prioritised outreach targets)
 * consumed by the Competitor Gap print report. The requests themselves are
 * issued through `useAnalysisEndpoint` (see `hooks/useReportsOverview.ts`
 * and `hooks/useCompetitorRollup.ts`).
 */
import type {
  HistoricalTrendsResponse, Recommendation, ReportScopeInfo
} from '../types';
import type { BrandKpis } from '../types/domain/groupKpiHistory';
import type { ScopedResponseFields } from '../types/domain/scopeCoverage';

/** A keyword whose visibility score moved most since its previous period. */
export interface ReportsOverviewMover {
  keyword: string;
  visibility_score: number;
  /** Points of visibility score since the keyword's previous period. */
  change: number;
}

interface ReportsOverviewSummary {
  improving_count: number;
  declining_count: number;
  stable_count: number;
}

/**
 * `GET /reports/overview`: the trend view's latest KPIs and change
 * (`lambda/api/get-reports-overview.py`), the top movers and the top
 * recommendations.
 */
export interface ReportsOverviewResponse extends ScopedResponseFields {
  generated_at: string;
  scope: ReportScopeInfo;
  period_type: 'day' | 'week' | 'month';
  days_analyzed: number;
  keywords_analyzed: number;
  keywords_with_data: number;
  citations_configured: boolean;
  /** Every KPI over each keyword's latest period, pooled. */
  kpis: BrandKpis;
  change: HistoricalTrendsResponse['change'];
  trend_data: HistoricalTrendsResponse['trend_data'];
  latest_brands: HistoricalTrendsResponse['latest_brands'];
  /** Some run of the window kept only its top 25 brands (`HistoricalTrendsResponse['brands_truncated']`). */
  brands_truncated?: boolean;
  summary: ReportsOverviewSummary;
  top_improving: ReportsOverviewMover[];
  top_declining: ReportsOverviewMover[];
  top_recommendations: Recommendation[];
  truncated_before?: Exclude<HistoricalTrendsResponse['truncated_before'], undefined>;
}

export interface CompetitorOutrankedKeyword {
  keyword: string;
  their_best_rank: number;
  our_best_rank: number | null;
  rank_delta: number | null;
  providers: string[];
}

export interface CompetitorExclusiveSource {
  keyword: string;
  url: string;
  domain: string;
  priority: 'high' | 'medium' | 'low';
  citation_count: number;
  provider_count: number;
  providers: string[];
  lift_score: number;
}

export interface CompetitorRollup {
  competitor: string;
  /** The first page of outranked keywords (all of them before 2.45.0). */
  outranked_keywords: CompetitorOutrankedKeyword[];
  /** The next page (`next_token=`); `null`/absent on the last. */
  outranked_keywords_next_token?: string | null;
  outranked_keywords_total?: number;
  /** Every source citing the competitor but no first-party brand (only the best ten are listed). */
  exclusive_source_count: number;
  /** How many of those sources are high priority (cited by two engines or more). */
  high_priority_source_count: number;
  /** The first page of exclusive sources, best outreach lift first (the best ten before 2.45.0). */
  outreach_targets: CompetitorExclusiveSource[];
  /** The next page of every exclusive source (`view=outreach&next_token=`, 2.45.0 wave 5); `null`/absent on the last. */
  outreach_targets_next_token?: string | null;
  /** How many exclusive sources there are in all (else `exclusive_source_count`). */
  outreach_targets_total?: number;
}

/** `GET /reports/competitor?competitor=…`: the rollup of that one competitor. */
export interface CompetitorReportResponse extends ScopedResponseFields {
  keywords_analyzed: number;
  /** Whether a live read the time budget cut left keywords out (before 2.45.0: beyond `keyword_limit`). */
  keywords_truncated?: boolean;
  rollup: CompetitorRollup;
}
