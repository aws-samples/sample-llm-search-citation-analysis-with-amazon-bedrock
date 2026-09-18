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
  /** Research agent: the expansion dimension the keyword serves. */
  dimension?: string;
  /** Research agent: why the final selection kept this keyword. */
  rationale?: string;
  /** Where a provider found the keyword (free text). */
  source?: string;
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
  /** Research agent: the round the step belongs to. */
  round?: number;
  /** Research agent: the planned search query this step ran. */
  query?: string;
  /** Research agent: the expansion dimension of the query. */
  dimension?: string;
  /** Research agent: the Google-signals step covers this many queries. */
  query_count?: number;
}

/** Expansion dimensions the research agent can plan queries for (R19). */
export type AgentDimension =
  | 'destination'
  | 'location'
  | 'points_of_interest'
  | 'hotel_attributes'
  | 'audience'
  | 'trip_type';

/** The brief an agent job was started with. */
export interface AgentConfig {
  seed: string;
  country: string;
  language: string;
  dimensions: AgentDimension[];
  instruction: string;
  target_count: number;
  max_rounds: number;
  group_id: string | null;
}

/** One search query the agent planned, tagged with its dimension. */
export interface PlannedQuery {
  query: string;
  dimension: string;
  rationale: string;
}

/** The evaluator's verdict on a round. */
export interface AgentEvaluation {
  assessment: string;
  decision: 'continue' | 'stop';
  reason: string;
  next_queries: PlannedQuery[];
  candidate_count?: number;
  evaluated_at?: string;
}

/** One round of the agent trace: what was planned and how it was judged. */
export interface AgentRound {
  round: number;
  planned_at: string;
  strategy: string;
  queries: PlannedQuery[];
  step_ids: string[];
  evaluation?: AgentEvaluation;
}

/** A saved (or the built-in) system prompt for the research agent. */
export interface ResearchTemplate {
  id: string;
  name: string;
  description: string;
  system_prompt: string;
  builtin: boolean;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

/**
 * Keyword research history item.
 */
export interface KeywordResearchItem {
  id: string;
  type: 'expansion' | 'competitor' | 'agent';
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
  /** Research agent fields (absent on expansion / competitor jobs). */
  config?: AgentConfig;
  round?: number;
  rounds?: AgentRound[];
  /** The prompt snapshot the run used; the history listing omits it. */
  system_prompt?: string;
  template_id?: string;
  template_name?: string;
  /** Candidates found before the final selection. */
  candidates_count?: number;
  /** How the final list was produced: by the model, or the top candidates when it failed. */
  proposal_source?: 'model' | 'fallback' | 'none';
  created_by?: string;
}
