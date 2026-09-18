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
  /** Providers that proposed this keyword (merged across parallel steps). */
  providers?: string[];
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
 * Lifecycle of a keyword-research job. `processing` only appears on rows
 * written before 2.2.0 (the self-invoke era); new jobs go
 * pending -> running -> completed | partial | failed. Absent on rows written
 * before the backend started recording it.
 */
export type ResearchStatus = 'pending' | 'running' | 'processing' | 'completed' | 'partial' | 'failed';

/** Lifecycle of one provider step inside a research job. */
export type ResearchStepStatus = 'pending' | 'running' | 'completed' | 'failed';

/**
 * One provider's step of a research job. Each step checkpoints on its own,
 * so a job can be `partial`: some providers answered, others failed.
 */
export interface ResearchStep {
  step_id: string;
  provider: string;
  status: ResearchStepStatus;
  keyword_count: number;
  error_message?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
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
  status?: ResearchStatus;
  provider?: string;
  error_message?: string;
  steps?: ResearchStep[];
  steps_total?: number;
  steps_done?: number;
  steps_failed?: number;
  retry_count?: number;
  updated_at?: string;
  finished_at?: string;
}
