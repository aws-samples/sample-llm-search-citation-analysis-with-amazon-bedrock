import type { BrandClassification } from './brands';
import type { ReportScopeInfo } from './baseTypes';
import type {
  BrandKpis, KpiDeltas, KpiTrend, TrendedKpiId
} from './groupKpiHistory';

/**
 * One brand named in a scope's answers (`brand_table` in
 * `lambda/shared/kpi_engine.py`): the tracked-brand formulas applied to
 * that brand alone. Leaderboards are sorted by visibility score.
 */
export interface BrandLeaderboardRow {
  name: string;
  classification: BrandClassification;
  mentions: number;
  mention_rate: number | null;
  share_of_voice: number | null;
  average_position: number | null;
  best_position: number | null;
  visibility_score: number;
  /** The AI engines whose answers name the brand, sorted. */
  engines: string[];
  /** How many keywords' answers name the brand. */
  keywords: number;
  net_sentiment: number | null;
}

/** One keyword of a visibility view: its latest run, or no data. */
export interface KeywordVisibilityRow {
  keyword: string;
  timestamp: string | null;
  has_data: boolean;
  kpis: BrandKpis | null;
}

/**
 * `GET /visibility` for any scope (one keyword, a group, keyword ids or all):
 * every KPI over each keyword's latest run, pooled
 * (`lambda/shared/visibility_views.py`).
 */
export interface VisibilityResponse {
  scope: ReportScopeInfo;
  /** The newest run among the keywords. */
  timestamp: string | null;
  keywords_truncated: boolean;
  /** Whether owned domains are configured, so the citation KPIs are measured. */
  citations_configured: boolean;
  keywords_analyzed: number;
  keywords_with_data: number;
  kpis: BrandKpis;
  /** Latest against previous run over the keywords answered in both; `null` without such a keyword. */
  change: ScopeChange | null;
  brands: BrandLeaderboardRow[];
  /** Every KPI per AI engine, engines in name order. */
  engines: EngineKpis[];
  /** The most cited domains (at most 25), most cited first. */
  sources: SourceRow[];
  /** How many distinct domains the answers cite. */
  sources_total: number;
  keywords: KeywordVisibilityRow[];
}

/** Every KPI of the tracked brand over one AI engine's answers. */
export interface EngineKpis {
  engine: string;
  kpis: BrandKpis;
}

/** One domain cited in a scope's answers (`source_table`). */
export interface SourceRow {
  domain: string;
  /** One of the brand's owned domains, or a subdomain of one. */
  owned: boolean;
  /** Answers citing the domain. */
  citations: number;
  citation_rate: number | null;
  citation_share: number | null;
  engines: string[];
  keywords: number;
}

/** One period of a brand's trend. */
export interface BrandTrendPoint {
  period: string;
  share_of_voice: number | null;
  mention_rate: number | null;
  visibility_score: number | null;
  average_position: number | null;
}

/** The tracked brand and its leading competitors over time (`/trends`). */
export interface BrandTrends {
  tracked: BrandTrendPoint[];
  competitors: Array<{
    name: string;
    points: BrandTrendPoint[];
  }>;
}

interface PromptBrandData {
  mentions: number;
  best_rank: number | null;
  provider_coverage: number;
}

type PromptStatus = 'winning' | 'losing' | 'opportunity' | 'neutral';

export interface PromptInsight {
  keyword: string;
  timestamp: string;
  first_party: PromptBrandData;
  competitors: PromptBrandData;
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

type GapPriority = 'high' | 'medium' | 'low';

export interface CitationGap {
  url: string;
  domain: string;
  citation_count: number;
  providers: string[];
  provider_count: number;
  first_party_brands: string[];
  competitor_brands: string[];
  priority: GapPriority;
  title?: string;
  seo_analysis?: Record<string, unknown>;
  keyword?: string;
  /** `video` for a cited YouTube video (absent from older API answers: a page). */
  content_type?: 'video' | 'page';
}

interface DomainGapSummary {
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

/** Where a recommendation stands in the Action Center; stored by `POST /api/recommendations/{id}/status`. */
export type RecommendationStatus = 'new' | 'in_progress' | 'done' | 'wontfix';

export interface Recommendation {
  type: string;
  priority: GapPriority;
  title: string;
  description: string;
  action: string;
  impact: string;
  keywords?: string[];
  /** Stable id (hash of type, title and keywords); rule-based recommendations only, AI-enhanced ones have none. */
  id?: string;
  /** `new` unless someone changed it. */
  status?: RecommendationStatus;
  notes?: string;
  related_keyword?: string;
  related_content_id?: string;
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

export type TrendDirection = KpiTrend;

/** One period of a trend: every answer of the scope in that day, ISO week or month. */
export interface TrendDataPoint {
  period: string;
  /** Analysis runs in the period. */
  runs: number;
  keywords_with_data: number;
  kpis: BrandKpis;
}

export type PeriodType = 'day' | 'week' | 'month';

/** A change between two periods: every KPI's delta and each rate's trend. */
interface PeriodChange {
  deltas: KpiDeltas;
  trends: Record<TrendedKpiId, KpiTrend>;
}

/** A scope's change, like for like: computed over the keywords measured on both sides. */
export interface ScopeChange extends PeriodChange {keywords_compared: number;}

/** One keyword's latest period and its change since the keyword's previous period. */
export interface KeywordTrend {
  keyword: string;
  period: string;
  kpis: BrandKpis;
  change: (PeriodChange & { previous_period: string }) | null;
}

/**
 * `GET /trends` for any scope (`lambda/shared/visibility_views.py`
 * `trend_view`): the KPIs per period, the latest standing and its change,
 * and each keyword's move.
 */
export interface HistoricalTrendsResponse {
  scope: ReportScopeInfo;
  period_type: PeriodType;
  days_analyzed: number;
  since: string;
  keywords_analyzed: number;
  keywords_with_data: number;
  keywords_truncated: boolean;
  citations_configured: boolean;
  trend_data: TrendDataPoint[];
  /** Every KPI over each keyword's latest period, pooled. */
  latest: BrandKpis;
  /** The brand leaderboard of those latest periods (at most 10). */
  latest_brands: BrandLeaderboardRow[];
  /** Latest against previous period over the keywords measured in both; `null` before a second period. */
  change: ScopeChange | null;
  /** Best visibility score first. */
  keyword_trends: KeywordTrend[];
  /** Keywords by the trend of their visibility score. */
  overall: {
    improving_count: number;
    declining_count: number;
    stable_count: number;
  };
  brand_trends: BrandTrends;
}

interface PersonaBrandRanking {
  rank: number;
  classification: BrandClassification;
}

interface PersonaRankingGroup {
  persona_name: string;
  brands: PersonaBrandRanking[];
}

export interface CrossPersonaBrandSummary {
  name: string;
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
}

export interface SelfReflectionResult {
  keyword: string;
  brand: string;
  current_rank: number | null;
  explanation: string;
  content_contributions: string;
  competitor_advantages: string;
  missing_data_points: string;
  recommendations: ContentRecommendation[];
}

export type SelfReflectionResponse = SelfReflectionResult;
