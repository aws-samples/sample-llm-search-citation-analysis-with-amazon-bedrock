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
  /** Research agent: whether this keyword is in the recommended tracked subset. */
  tracking?: boolean;
  /** Demand-proxy score based on available relevance, intent and source signals. */
  tracking_score?: number;
  /** Concise explanation of the available signals behind the tracking score. */
  tracking_reason?: string;
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

/**
 * One expansion dimension a template offers (R19). `id` is what the brief
 * sends and the model tags queries and keywords with; `label` is what the UI
 * shows for it.
 */
export interface AgentDimensionOption {
  id: string;
  label: string;
  description: string;
}

/**
 * The brief an agent job was started with, plus the industry profile the
 * template had at start time (`subject`, `audience`, `dimension_catalog`).
 * `dimensions` holds catalogue ids. The API backfills the profile on rows
 * written before 2.6.0.
 */
export interface AgentConfig {
  seed: string;
  country: string;
  language: string;
  dimensions: string[];
  instruction: string;
  target_count: number;
  /** Requested recommendation size; absent only on legacy jobs. */
  tracking_count?: number;
  max_rounds: number;
  group_id: string | null;
  subject: string;
  audience: string;
  dimension_catalog: AgentDimensionOption[];
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

/**
 * An industry profile for the research agent: the built-ins (hotels,
 * restaurants, cafés, retail, generic) or one the team saved. Besides the
 * system prompt it names what is researched (`subject`), who searches for it
 * (`audience`) and the expansion dimensions a brief can pick from.
 */
export interface ResearchTemplate {
  id: string;
  name: string;
  description: string;
  industry: string;
  subject: string;
  audience: string;
  dimensions: AgentDimensionOption[];
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
  /** Actual number of proposal entries marked for tracking after finalization. */
  tracking_count?: number;
  /** How the final list was produced: by the model, or the top candidates when it failed. */
  proposal_source?: 'model' | 'fallback' | 'none';
  created_by?: string;
}
