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
  brand_count: number;
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
  provider: string;
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
  keyword: string;
  timestamp: string;
  config: BrandConfig | null;
  by_provider: ProviderBrandData[];
  aggregated: {
    brands: AggregatedBrand[];
    total_unique_brands: number;
    first_party_brands: AggregatedBrand[];
    competitor_brands: AggregatedBrand[];
    other_brands: AggregatedBrand[];
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
 * Map of industry keys to their preset configurations.
 */
export interface IndustryPresets {[key: string]: IndustryPreset;}
