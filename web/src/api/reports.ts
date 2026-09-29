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

/** A keyword whose visibility score moved most since its previous period. */
export interface ReportsOverviewMover {
  keyword: string;
  visibility_score: number;
  /** Points of visibility score since the keyword's previous period. */
  change: number;
}

export interface ReportsOverviewSummary {
  improving_count: number;
  declining_count: number;
  stable_count: number;
}

/**
 * `GET /reports/overview`: the trend view's latest KPIs and change
 * (`lambda/api/get-reports-overview.py`), the top movers and the top
 * recommendations.
 */
export interface ReportsOverviewResponse {
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
  summary: ReportsOverviewSummary;
  top_improving: ReportsOverviewMover[];
  top_declining: ReportsOverviewMover[];
  top_recommendations: Recommendation[];
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
  outranked_keywords: CompetitorOutrankedKeyword[];
  exclusive_sources: CompetitorExclusiveSource[];
  outreach_targets: CompetitorExclusiveSource[];
}

export interface CompetitorReportSingleResponse {
  generated_at: string;
  keywords_analyzed: number;
  competitor: string;
  rollup: CompetitorRollup;
}

export interface CompetitorReportAllResponse {
  generated_at: string;
  keywords_analyzed: number;
  competitors: string[];
  rollups: CompetitorRollup[];
}

export type CompetitorReportResponse =
  | CompetitorReportSingleResponse
  | CompetitorReportAllResponse;

export function isSingleCompetitorResponse(
  response: CompetitorReportResponse,
): response is CompetitorReportSingleResponse {
  return 'rollup' in response;
}
