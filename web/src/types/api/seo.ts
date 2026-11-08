/**
 * SEO API shapes (`${SEO_API_BASE_URL}/seo/...`), one-to-one with what `lambda/seo/` sends
 * (snake_case). Checked at runtime by `web/src/api/seoDecoders.ts`.
 */

export type KeywordIntent = 'informational' | 'commercial' | 'transactional' | 'navigational' | 'unknown';
export type KeywordDataSource = 'labs' | 'google_ads';
export type KeywordResearchMode = 'auto' | 'related' | 'suggestions' | 'ideas';
export type SeoGeoQuadrant = 'both_strong' | 'ai_gap' | 'seo_gap' | 'both_weak' | 'no_data';
/** Where a SEO vs GEO row's position comes from: the AI Overviews results page, a domain snapshot or rank tracking. */
export type OrganicPositionSource = 'serp_top10' | 'ranked_keywords' | 'rank_tracking';

/**
 * How a DataForSEO-paged table can be exported (the `export` block of its every answer): at most `max_rows`
 * rows, asked `rows_per_request` at a time, each request priced at most `request_usd` plus `row_usd` a row.
 */
export interface SeoExportPricing {
  readonly max_rows: number;
  readonly rows_per_request: number;
  readonly request_usd: number;
  readonly row_usd: number;
  /** How long the SEO API keeps a window cached: exporting the same rows again within it is free. */
  readonly cache_hours: number;
}

/** The fields every answer of a DataForSEO-paged table adds: the window an export chunk asked (`null` on a page) and the export pricing. */
export interface SeoExportAnswer {
  readonly offset: number | null;
  readonly limit: number | null;
  readonly export: SeoExportPricing;
}

/** The two optional request fields asking `limit` rows from `offset` instead of a page (an export chunk). */
export interface SeoExportWindow {
  readonly offset?: number;
  readonly limit?: number;
}

export interface MonthlySearch {
  year: number;
  month: number;
  search_volume: number;
}

export interface KeywordRow {
  keyword: string;
  search_volume: number | null;
  trend: MonthlySearch[];
  keyword_difficulty: number | null;
  cpc: number | null;
  competition: number | null;
  intent: KeywordIntent;
}

export interface OrganicItem {
  position: number;
  rank_absolute: number | null;
  url: string;
  domain: string;
  title: string;
  description: string;
}

export interface KeywordResearchRequest {
  keyword: string;
  market_id?: string;
  mode?: KeywordResearchMode;
  limit?: 150 | 300 | 500;
  group_keywords?: boolean;
  clickstream?: boolean;
}

export interface KeywordResearchResponse {
  keyword: string;
  market_id: string;
  location_code: number;
  language_code: string;
  data_source: KeywordDataSource;
  source: string;
  used_fallback: boolean;
  rows: KeywordRow[];
  cached: boolean;
  fetched_at: string;
}

export interface SerpRequest {
  keyword: string;
  market_id?: string;
  depth?: 20 | 50;
}

export interface SerpResponse {
  keyword: string;
  market_id: string;
  depth: number;
  items: OrganicItem[];
  item_types: string[];
  has_ai_overview: boolean;
  check_url: string | null;
  cached: boolean;
  fetched_at: string;
}

export interface SeoAccount {
  configured: boolean;
  login: string | null;
  balance_usd: number | null;
}

export interface SeoGeoRow {
  keyword_id: string;
  keyword: string;
  search_volume: number | null;
  organic_position: number | null;
  /** The best position from a source deeper than the results page's top 10 (snapshot or rank tracking). */
  ranked_position: number | null;
  organic_position_source: OrganicPositionSource | null;
  /** Your estimated monthly organic visits for the keyword (latest domain snapshot; a DataForSEO estimate). */
  estimated_traffic: number | null;
  competitor_positions: Record<string, number | null>;
  ai_overview_shown: boolean | null;
  ai_overview_cites_you: boolean | null;
  ai_overview_cited_competitors: string[];
  ai_mention_rate: number | null;
  answers: number;
  citation_overlap: number | null;
  quadrant: SeoGeoQuadrant;
  last_run: string | null;
}

export interface SeoGeoSummary {
  both_strong: number;
  ai_gap: number;
  seo_gap: number;
  both_weak: number;
  no_data: number;
}

/** You or one competitor: share of the scope's estimated search traffic against share of AI mentions. */
export interface TrafficShareEntry {
  name: string;
  owned: boolean;
  estimated_traffic: number | null;
  traffic_share: number | null;
  share_of_voice: number | null;
}

export interface SeoGeoResponse {
  market_id: string;
  group_id: string | null;
  generated_at: string;
  thresholds: {
    seo_top_position: number;
    geo_mention_rate: number 
  };
  summary: SeoGeoSummary;
  rows: SeoGeoRow[];
  traffic_comparison: TrafficShareEntry[];
  traffic_snapshot_at: string | null;
}
