import type { BrandClassification } from './brands';

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

export interface Recommendation {
  type: string;
  priority: GapPriority;
  title: string;
  description: string;
  action: string;
  impact: string;
  keywords?: string[];
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
  period_type: PeriodType;
  days_analyzed: number;
  data_points: number;
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
