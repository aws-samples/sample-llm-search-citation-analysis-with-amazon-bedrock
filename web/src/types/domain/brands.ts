import type { ReportScopeInfo } from './baseTypes';
/**
 * Brand-related types for brand mentions, visibility, and configuration.
 */

/** Brand classification based on user configuration */
export type BrandClassification = 'first_party' | 'competitor' | 'other';

/**
 * Individual brand mention extracted from an AI response.
 */
export interface BrandMention {
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
  response_preview: string;
  full_response?: string;
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
  rank: number;
  mention_count: number;
  first_position: number;
  sentiment?: string;
  sentiment_reason?: string;
  ranking_context?: string;
}

/**
 * Aggregated brand data across all AI providers.
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
  providers: string[];
  appearances: BrandAppearance[];
  /** Distinct keywords mentioning the brand (2.4.0; meaningful for group answers). */
  keyword_count?: number;
  keywords?: string[];
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
    brands: AggregatedBrand[];
    total_unique_brands: number;
    first_party_brands: AggregatedBrand[];
    competitor_brands: AggregatedBrand[];
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
  entity_types: string[];
  example_brands: string[];
  extraction_focus: string;
  default_prompt: string;
}

/**
 * Map of industry keys to preset configurations.
 */
export interface IndustryPresets {[key: string]: IndustryPreset;}
