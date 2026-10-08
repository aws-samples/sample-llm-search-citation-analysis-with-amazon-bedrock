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

/** What a cited URL is: a YouTube video or any other page (`shared/youtube.py` decides). */
export type CitationContentType = 'video' | 'page';

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
  content_type?: CitationContentType;
  /** `'youtube'` when the details came from YouTube oEmbed instead of a browser crawl. */
  provider?: string;
  /** The video's channel name and link (oEmbed `author_name` / `author_url`). */
  author_name?: string;
  author_url?: string;
  /** An https thumbnail of the video, empty when YouTube gave none. */
  thumbnail_url?: string;
}
