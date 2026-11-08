/**
 * Domain Overview and SEO recommendation shapes (`${SEO_API_BASE_URL}/seo/domains/...`, `/seo/insights`),
 * one-to-one with what `lambda/seo/seo-domains.py` sends (snake_case). Checked at runtime by
 * `web/src/api/seoDomainsDecoders.ts`. Traffic figures are DataForSEO estimates, never measured clicks.
 */
import type {
  Recommendation, RecommendationStatus
} from '../domain/visibility';
import type {
  KeywordIntent, SeoExportAnswer, SeoExportWindow
} from './seo';

export type DomainScope = 'exact_url' | 'subfolder' | 'domain' | 'subdomains';
export type DomainKeywordSort = 'rank' | 'traffic' | 'volume' | 'score' | 'cpc';
export type DomainPageSort = 'traffic' | 'keywords';
export type SortOrder = 'asc' | 'desc';
export type DomainPageSize = 50 | 100;

export interface DomainTargetRequest {
  target: string;
  scope?: DomainScope;
  market_id?: string;
}

export interface DomainKeywordFilters {
  include?: string;
  exclude?: string;
  min_volume?: number;
  max_volume?: number;
  min_traffic?: number;
  max_traffic?: number;
  min_cpc?: number;
  max_cpc?: number;
  min_kd?: number;
  max_kd?: number;
  min_rank?: number;
  max_rank?: number;
}

export interface DomainPageFilters {
  include?: string;
  exclude?: string;
  min_traffic?: number;
  max_traffic?: number;
  min_keywords?: number;
  max_keywords?: number;
}

/** A page (`page`, `page_size`) or, with `limit`, an export chunk of `limit` rows from `offset`. */
interface PagedRequest<TSort, TFilters> extends DomainTargetRequest, SeoExportWindow {
  page?: number;
  page_size?: DomainPageSize;
  sort?: TSort;
  order?: SortOrder;
  search?: string;
  filters?: TFilters;
}

export type DomainKeywordsRequest = PagedRequest<DomainKeywordSort, DomainKeywordFilters>;
export type DomainPagesRequest = PagedRequest<DomainPageSort, DomainPageFilters>;

/** The resolved target every domain answer echoes. */
export interface DomainTarget {
  target: string;
  hostname: string;
  scope: DomainScope;
  path: string;
  market_id: string;
}

interface PaidAnswer {
  cached: boolean;
  fetched_at: string;
}

export interface PositionBucket {
  label: string;
  keywords: number;
}

/** The domain-wide figures of an overview and of a stored snapshot. */
interface DomainFigures {
  organic_keywords: number | null;
  /** Estimated monthly organic visits (a DataForSEO estimate). */
  estimated_traffic: number | null;
  /** What that traffic would cost as Google Ads clicks, USD per month. */
  traffic_cost: number | null;
  position_buckets: PositionBucket[];
}

export interface DomainOverviewResponse extends DomainTarget, PaidAnswer, DomainFigures {
  /** The figures cover the whole host (and its subdomains) whatever the scope. */
  domain_wide: boolean;
  has_data: boolean;
}

export interface RankedKeywordRow {
  keyword: string;
  /** Absolute rank: every results-page element counted. */
  position: number | null;
  /** Organic rank: organic results only. */
  organic_position: number | null;
  search_volume: number | null;
  etv: number | null;
  cpc: number | null;
  keyword_difficulty: number | null;
  url: string | null;
  relative_url: string | null;
  /** DataForSEO's main search intent; `unknown` when it names none. */
  intent: KeywordIntent;
}

export interface TopPageRow {
  url: string;
  relative_url: string | null;
  etv: number | null;
  keywords: number | null;
}

interface PagedResponse<TRow> extends DomainTarget, PaidAnswer, SeoExportAnswer {
  page: number;
  page_size: number;
  total_count: number | null;
  has_more: boolean;
  items: TRow[];
}

export type DomainKeywordsResponse = PagedResponse<RankedKeywordRow>;
export type DomainPagesResponse = PagedResponse<TopPageRow>;

export interface SerpCompetitorRow {
  domain: string;
  avg_position: number | null;
  median_position: number | null;
  visibility: number | null;
  etv: number | null;
  keywords_count: number | null;
}

export interface SerpCompetitorsRequest {
  keywords: string[];
  market_id?: string;
}

export interface SerpCompetitorsResponse extends PaidAnswer {
  market_id: string;
  keywords_count: number;
  items: SerpCompetitorRow[];
}

export interface DomainSnapshotSummary extends DomainFigures {
  domain: string;
  market_id: string;
  snapshot_at: string;
  keywords_stored: number;
}

export interface DomainSnapshotsResponse {
  domain: string;
  market_id: string;
  source: string;
  estimated: boolean;
  snapshots: DomainSnapshotSummary[];
}

/** Whether the weekly sweep of every tracked domain is on (off until an Admin turns it on: it is paid). */
export interface DomainSnapshotScheduleResponse {readonly schedule_enabled: boolean;}

export interface TakeSnapshotResponse {
  domain: string;
  market_id: string;
  execution: string;
}

export type SeoRecommendationType = 'aio_missing_you' | 'aio_competitor_cited' | 'ai_gap' | 'seo_gap';

export interface SeoRecommendation {
  id: string;
  type: SeoRecommendationType;
  priority: Recommendation['priority'];
  title: string;
  description: string;
  action: string;
  keywords: string[];
  impact: string;
  status: RecommendationStatus;
  notes?: string;
  related_keyword?: string;
  related_content_id?: string;
}

export interface SeoInsightsResponse {
  market_id: string;
  group_id: string | null;
  generated_at: string;
  recommendations: SeoRecommendation[];
  total_count: number;
}
