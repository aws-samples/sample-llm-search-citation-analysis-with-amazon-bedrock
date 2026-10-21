import type { ReportScopeInfo } from './baseTypes';
/**
 * Brand-related types for brand mentions, visibility, and configuration.
 */

/** Brand classification based on user configuration */
export type BrandClassification = 'first_party' | 'competitor' | 'other';

/**
 * Individual brand mention extracted from an AI response.
 */
interface BrandMention {
  name: string;
  parent_company: string | null;
  rank: number;
  mention_count: number;
  first_position: number;
  sentiment?: string;
  sentiment_reason?: string;
  ranking_context?: string;
  classification?: BrandClassification;
}

/**
 * Brand data from a single AI provider response.
 */
export interface ProviderBrandData {
  provider: string;
  timestamp: string;
  brands: BrandMention[];
  /** The persona the answer was asked under (`default` without one). */
  query_prompt_id?: string;
  response_preview: string;
  /** The answer text, cut at 12,000 characters (`response_truncated`). */
  full_response?: string;
  response_truncated?: boolean;
  /** Characters of the stored answer, before any cut. */
  response_length?: number;
  seo_feedback?: string;
  geo_feedback?: string;
  citations?: string[];
}

/**
 * Brand appearance in a specific provider's response.
 */
export interface BrandAppearance {
  keyword: string;
  provider: string;
  model: string;
  /** The persona of the answer (`default` without one). */
  query_prompt_id?: string;
  rank: number;
  mention_count: number;
  first_position: number;
  sentiment?: string;
  sentiment_reason?: string;
  /** The verbatim passage carrying the sentiment (rows extracted since 2.25.0). */
  sentiment_quote?: string;
  ranking_context?: string;
}

/** Appearances per sentiment label; labels nobody used are absent. */
export type SentimentCounts = Partial<Record<'positive' | 'neutral' | 'negative' | 'mixed', number>>;

/**
 * One brand of a `/brand-mentions` summary: aggregates over every appearance
 * and a bounded preview of them (`view=appearances` pages hold the rest).
 */
export interface AggregatedBrand {
  name: string;
  parent_company: string | null;
  provider_count: number;
  total_mentions: number;
  best_rank: number;
  overall_rank: number;
  aggregate_score: number;
  classification: BrandClassification;
  /** Distinct providers that named the brand, sorted. */
  providers: string[];
  /** Each provider's best rank of the brand. */
  provider_ranks: Record<string, number>;
  /** The best-ranked appearances: all of them for one keyword (up to 30), 5 for a wider scope. */
  appearances: BrandAppearance[];
  /** Every appearance, however many `appearances` previews. */
  appearance_count: number;
  sentiment_counts: SentimentCounts;
  /** Distinct keywords mentioning the brand (meaningful for group answers). */
  keyword_count?: number;
}

/** One row of a `view=appearances` page: an appearance tagged with its brand. */
export interface BrandAppearanceRow extends BrandAppearance {
  brand: string;
  classification: BrandClassification;
  overall_rank: number;
}

/** One `view=appearances` page of `/brand-mentions`. */
export interface BrandAppearancesPage {
  keyword: string | null;
  timestamp: string | null;
  brand: string | null;
  appearances: BrandAppearanceRow[];
  total_appearances: number;
  next_token: string | null;
}

/**
 * Brand tracking configuration.
 */
export interface BrandConfig {
  config_id?: string;
  industry: string;
  extract_brands: boolean;
  include_sentiment: boolean;
  include_ranking_context: boolean;
  max_brands: number;
  tracked_brands: {
    first_party: string[];
    competitors: string[];
  };
  first_party_domains?: string[];
  /** Each tracked competitor's website domains (absent on configs saved before 2026-10). */
  competitor_domains?: Record<string, string[]>;
  custom_entity_types: string[];
  custom_prompt_additions: string;
  industry_prompts: { [key: string]: string };
  created_at?: string;
  updated_at?: string;
}

/**
 * Complete brand mentions response from the API.
 */
export interface BrandMentionsResponse {
  /** Null for a group / all answer, which has no single keyword. */
  keyword: string | null;
  timestamp: string | null;
  /** Distinct analysis runs represented by the loaded scope, newest first. */
  available_runs: string[];
  /** Present on group / all answers. */
  scope?: ReportScopeInfo;
  keywords_analyzed?: number;
  keywords_with_data?: number;
  config: BrandConfig | null;
  /** Per-provider responses; empty for a group / all answer. */
  by_provider: ProviderBrandData[];
  aggregated: {
    /** The best 100 brands of the requested classification, best aggregate score first. */
    brands: AggregatedBrand[];
    /** Every brand of the rows, whatever the classification filter. */
    total_unique_brands: number;
    /** Brands of the requested classification, before the cap of `brands`. */
    matching_brands: number;
    brands_truncated: boolean;
    summary: {
      first_party_count: number;
      competitor_count: number;
      other_count: number;
    };
  };
}

/**
 * Industry preset configuration.
 */
export interface IndustryPreset {
  name: string;
  description: string;
  example_brands: string[];
  default_prompt: string;
}

/**
 * Map of industry keys to preset configurations.
 */
export interface IndustryPresets {[key: string]: IndustryPreset;}
