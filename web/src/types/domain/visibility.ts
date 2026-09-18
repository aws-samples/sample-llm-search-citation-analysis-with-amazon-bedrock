import type { BrandClassification } from './brands';
import type { ReportScopeInfo } from './baseTypes';

export interface BrandVisibilityMetric {
  name: string;
  visibility_score: number;
  provider_count: number;
  providers: string[];
  total_mentions: number;
  best_rank: number | null;
  avg_sentiment: number;
  share_of_voice: number;
  classification: BrandClassification;
}

export interface VisibilityMetricsResponse {
  keyword: string;
  timestamp: string;
  total_brands: number;
  total_mentions: number;
  brands: BrandVisibilityMetric[];
  first_party: BrandVisibilityMetric[];
  competitors: BrandVisibilityMetric[];
  others: BrandVisibilityMetric[];
  summary: {
    first_party_avg_score: number;
    competitor_avg_score: number;
    first_party_total_sov: number;
    competitor_total_sov: number;
  };
}

/** A brand ranked across the keywords of a group (`/visibility?group_id=`). */
export interface GroupBrandVisibilityMetric {
  name: string;
  classification: BrandClassification;
  /** Mean visibility over the keywords the brand appears on. */
  visibility_score: number;
  share_of_voice: number;
  provider_count: number;
  providers: string[];
  total_mentions: number;
  best_rank: number | null;
  /** How many of the group's keywords mention the brand. */
  keyword_count: number;
}

/** One keyword's line in a group visibility summary. */
export interface KeywordVisibilityRow {
  keyword: string;
  has_data: boolean;
  timestamp: string | null;
  first_party_score: number;
  competitor_score: number;
  first_party_sov: number;
  competitor_sov: number;
  first_party_providers: number;
  total_mentions: number;
  first_party_mentioned: boolean;
}

/**
 * Group summary answered by `/visibility` for `group_id=`, `keyword_ids=` or
 * `scope=all`: per-keyword metrics averaged over the keywords with data.
 */
export interface GroupVisibilityResponse {
  scope: ReportScopeInfo;
  timestamp: string | null;
  total_providers: number;
  /** True when the scope had more keywords than the summary covers (100). */
  keywords_truncated?: boolean;
  keywords_analyzed: number;
  keywords_with_data: number;
  keywords: KeywordVisibilityRow[];
  brands: GroupBrandVisibilityMetric[];
  first_party: GroupBrandVisibilityMetric[];
  competitors: GroupBrandVisibilityMetric[];
  others: GroupBrandVisibilityMetric[];
  summary: {
    first_party_avg_score: number;
    competitor_avg_score: number;
    first_party_avg_sov: number;
    competitor_avg_sov: number;
    /** % of keywords (with data) where a first-party brand is mentioned. */
    coverage_rate: number;
    /** Mean share of enabled providers mentioning a first-party brand. */
    provider_coverage: number;
  };
}

export type VisibilityResponse = VisibilityMetricsResponse | GroupVisibilityResponse;

export function isGroupVisibilityResponse(data: VisibilityResponse): data is GroupVisibilityResponse {
  return 'scope' in data && 'keywords' in data;
}

export interface PromptBrandData {
  mentions: number;
  best_rank: number | null;
  provider_coverage: number;
  providers: string[];
}

export type PromptStatus = 'winning' | 'losing' | 'opportunity' | 'neutral';

export interface PromptInsight {
  keyword: string;
  timestamp: string;
  first_party: PromptBrandData;
  competitors: PromptBrandData;
  total_providers: number;
  status: PromptStatus;
  score?: number;
  improvement_potential?: number;
  opportunity_score?: number;
}

export interface PromptInsightsResponse {
  total_prompts_analyzed: number;
  winning_prompts: PromptInsight[];
  losing_prompts: PromptInsight[];
  opportunity_prompts: PromptInsight[];
  summary: {
    winning_count: number;
    losing_count: number;
    opportunity_count: number;
    win_rate: number;
  };
}

export type GapType = 'competitor_only' | 'neutral';
export type GapPriority = 'high' | 'medium' | 'low';

export interface CitationGap {
  url: string;
  domain: string;
  citation_count: number;
  providers: string[];
  provider_count: number;
  first_party_brands: string[];
  competitor_brands: string[];
  gap_type: GapType;
  priority: GapPriority;
  title?: string;
  seo_analysis?: Record<string, unknown>;
  keyword?: string;
}

export interface DomainGapSummary {
  domain: string;
  gap_count: number;
  total_citations: number;
}

export interface CitationGapsResponse {
  keyword?: string;
  scope?: ReportScopeInfo;
  timestamp?: string;
  gaps: CitationGap[];
  covered_sources: CitationGap[];
  domain_summary: DomainGapSummary[];
  summary: {
    total_sources: number;
    gap_count: number;
    covered_count: number;
    high_priority_gaps: number;
    coverage_rate: number;
  };
  keywords_analyzed?: number;
  keyword_summaries?: Array<{
    keyword: string;
    gap_count: number;
    high_priority_gaps: number;
    coverage_rate: number;
  }>;
  top_gaps?: CitationGap[];
  total_gaps?: number;
  total_high_priority?: number;
}

export type RecommendationStatus =
  | 'new'
  | 'in_progress'
  | 'done'
  | 'wontfix';

export interface Recommendation {
  type: string;
  priority: GapPriority;
  title: string;
  description: string;
  action: string;
  impact: string;
  keywords?: string[];
  /**
   * Server-computed deterministic id (SHA-1 of type+title+sorted keywords,
   * truncated to 16 chars). Stable across list regenerations so it can
   * be used to track per-recommendation action status.
   */
  id?: string;
  /** Persisted action-tracking state. Defaults to 'new' if untouched. */
  status?: RecommendationStatus;
  notes?: string;
  related_keyword?: string;
  related_content_id?: string;
  updated_at?: string;
  completed_at?: string;
}

export interface RecommendationsResponse {
  generated_at: string;
  recommendations: Recommendation[];
  llm_enhanced?: Recommendation[];
  total_count: number;
  by_priority: {
    high: number;
    medium: number;
    low: number;
  };
}

export type TrendDirection = 'improving' | 'declining' | 'stable';

export interface TrendDataPoint {
  period: string;
  visibility_score: number;
  total_mentions: number;
  provider_count: number;
  best_rank: number | null;
  analysis_runs: number;
}

export type PeriodType = 'day' | 'week' | 'month';

export interface HistoricalTrendsResponse {
  keyword?: string;
  /** Present on group / all answers. */
  scope?: ReportScopeInfo;
  keywords_truncated?: boolean;
  period_type: PeriodType;
  days_analyzed: number;
  data_points: number;
  /** Single keyword: its series. Group: per-bucket mean across keywords. */
  trend_data: TrendDataPoint[];
  trend_direction: TrendDirection;
  summary: {
    current_score: number;
    previous_score: number;
    change: number;
    change_percent: number;
    average_score: number;
    max_score: number;
    min_score: number;
  };
  keywords_analyzed?: number;
  keyword_trends?: Array<{
    keyword: string;
    trend_direction: TrendDirection;
    current_score: number;
    change: number;
    change_percent: number;
  }>;
  overall?: {
    improving_count: number;
    declining_count: number;
    stable_count: number;
    avg_score: number;
  };
}

export interface PersonaBrandRanking {
  name: string;
  rank: number;
  mention_count: number;
  sentiment: string;
  visibility_score: number;
  classification: BrandClassification;
}

export interface PersonaRankingGroup {
  persona_id: string;
  persona_name: string;
  brands: PersonaBrandRanking[];
}

export interface CrossPersonaBrandSummary {
  name: string;
  avg_rank: number;
  best_rank: number;
  worst_rank: number;
  best_persona: string;
  classification: BrandClassification;
}

export interface PersonaRankingsResponse {
  keyword: string;
  personas: PersonaRankingGroup[];
  cross_persona_summary: {brands: CrossPersonaBrandSummary[];};
}

export interface ContentRecommendation {
  title: string;
  description: string;
  priority: 'high' | 'medium' | 'low';
  content_type: string;
  gap_reference: string;
}

export interface SelfReflectionResult {
  keyword: string;
  brand: string;
  query_prompt_id: string;
  query_prompt_name: string;
  current_rank: number | null;
  explanation: string;
  content_contributions: string;
  competitor_advantages: string;
  missing_data_points: string;
  recommendations: ContentRecommendation[];
  industry: string;
  created_at: string;
}

export type SelfReflectionResponse = SelfReflectionResult;
