/**
 * Reports API client functions.
 *
 * Backed by the consolidated stats-insights Lambda. Endpoints here
 * return pre-aggregated payloads tailored for the print reports.
 *
 * `fetchCompetitorRollup` returns per-competitor rollup data
 * (outranked keywords, exclusive citation sources, prioritised
 * outreach targets) consumed by the Competitor Gap print report.
 */
import { apiGet } from './client';

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

export interface CompetitorReportParams {
  readonly competitor?: string;
  readonly keywordLimit?: number;
}

/**
 * Fetch the competitor rollup. When `competitor` is omitted the server
 * returns a `rollups[]` payload containing every configured competitor;
 * when provided, it returns a single `rollup` for that competitor.
 */
export function fetchCompetitorRollup(
  params: CompetitorReportParams = {},
  signal?: AbortSignal,
): Promise<CompetitorReportResponse> {
  const query: string[] = [];
  if (params.competitor) {
    query.push(`competitor=${encodeURIComponent(params.competitor)}`);
  }
  if (params.keywordLimit !== undefined) {
    query.push(`keyword_limit=${params.keywordLimit}`);
  }
  const qs = query.length > 0 ? `?${query.join('&')}` : '';
  return apiGet<CompetitorReportResponse>(`/reports/competitor${qs}`, { signal });
}

export function isSingleCompetitorResponse(
  response: CompetitorReportResponse,
): response is CompetitorReportSingleResponse {
  return 'rollup' in response;
}
