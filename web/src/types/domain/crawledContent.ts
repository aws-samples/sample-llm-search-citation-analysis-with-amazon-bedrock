/** How a crawl of a cited page ended. */
export type CrawlStatus = 'success' | 'blocked' | 'error';

/** Why the crawler recorded a page as blocked. */
export type BlockReason = 'captcha' | 'access_denied' | 'rate_limited' | 'geo_blocked' | 'login_required';

/** The crawler's SEO read of a cited page. */
export interface SEOAnalysis {
  relevance_score?: number;
  keyword_usage?: string;
  strengths?: string[];
  weaknesses?: string[];
  recommendations?: string[];
  competitive_advantage?: string;
}

/** A crawled citation page as `GET /crawled-content` returns it. */
export interface CrawledContent {
  normalized_url: string;
  title: string;
  summary: string;
  content: string;
  screenshot_url?: string;
  seo_analysis?: SEOAnalysis;
  crawled_at: string;
  keyword: string;
  citation_count: number;
  citing_providers: string[];
  page_load_time_ms?: number;
  content_length?: number;
  status?: CrawlStatus;
  block_reason?: BlockReason;
  error_message?: string;
}
