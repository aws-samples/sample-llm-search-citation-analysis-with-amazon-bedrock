/**
 * Research and content studio types.
 */

/**
 * Expanded keyword from seed keyword research.
 */
export interface ExpandedKeyword {
  keyword: string;
  intent: string;
  competition: string;
  relevance: number;
  opportunity?: string;
}

/**
 * Result of keyword expansion from a seed keyword.
 */
export interface KeywordExpansionResult {
  id: string;
  seed_keyword: string;
  industry: string;
  keywords: ExpandedKeyword[];
  keyword_count: number;
}

/**
 * SEO elements extracted from a webpage.
 */
export interface SeoElements {
  title: string;
  meta_description: string;
  h1_tags: string[];
  h2_tags: string[];
  h3_tags: string[];
  og_title: string;
  og_description: string;
  canonical: string;
  meta_keywords: string;
}

/**
 * Extended keyword with source information.
 */
export interface ExpandedKeywordWithSource extends ExpandedKeyword {source?: string;}

/**
 * Result of competitor URL analysis.
 */
export interface CompetitorAnalysisResult {
  id: string;
  url: string;
  domain: string;
  industry: string;
  page_focus?: string;
  provider?: string;
  primary_keywords: ExpandedKeywordWithSource[];
  secondary_keywords: ExpandedKeywordWithSource[];
  longtail_keywords: ExpandedKeywordWithSource[];
  content_gaps: ExpandedKeywordWithSource[];
  keyword_count: number;
  seo_elements?: SeoElements;
}

/**
 * Keyword from research results.
 */
export interface ResearchKeyword {
  keyword: string;
  intent: string;
  competition: string;
  relevance: number;
  opportunity?: string;
}

/**
 * Competitor analysis data structure.
 */
export interface CompetitorAnalysis {
  domain?: string;
  industry?: string;
  primary_keywords?: ResearchKeyword[];
  secondary_keywords?: ResearchKeyword[];
  longtail_keywords?: ResearchKeyword[];
  content_gaps?: ResearchKeyword[];
}

/**
 * Keyword research history item.
 */
export interface KeywordResearchItem {
  id: string;
  type: 'expansion' | 'competitor';
  seed_keyword?: string;
  url?: string;
  domain?: string;
  industry: string;
  keyword_count: number;
  created_at: string;
  keywords?: ResearchKeyword[];
  analysis?: CompetitorAnalysis;
  status?: string;
  provider?: string;
  error_message?: string;
}
