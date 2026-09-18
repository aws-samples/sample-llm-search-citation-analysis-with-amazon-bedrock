export interface Stats {
  total_searches: number;
  total_citations: number;
  total_crawled: number;
  unique_keywords: number;
}

export interface ProviderStat {
  provider: string;
  citation_count: number;
}

export interface BrandStat {
  brand: string;
  mention_count: number;
}

export interface TopUrl {
  url: string;
  citation_count: number;
  by_provider?: { [provider: string]: number };
  keyword_count?: number;
  keywords?: string[];
}

export interface Citations {
  provider_stats: ProviderStat[];
  brand_stats: BrandStat[];
  top_urls: TopUrl[];
}

export interface Search {
  keyword: string;
  provider: string;
  timestamp: string;
  citations?: string[];
  response?: string;
  query_prompt_id?: string;
  query_prompt_name?: string;
}

export interface Keyword {
  id: string;
  keyword: string;
  created_at: string;
  status?: 'active' | 'inactive' | 'paused';
  /** Ids of the keyword groups this keyword belongs to (absent = none). */
  group_ids?: string[];
}

/** A folder of keywords, typically one per hotel / property. */
export interface KeywordGroup {
  id: string;
  name: string;
  description: string;
  keyword_count: number;
  created_at: string;
  updated_at: string;
}

/**
 * What an analysis run should cover, resolved server-side against the active
 * keyword list: everything, whole groups, or explicit keyword ids.
 */
export type AnalysisScope =
  | { mode: 'all' }
  | {
    mode: 'groups';
    group_ids: string[] 
  }
  | {
    mode: 'keywords';
    keyword_ids: string[] 
  };

export interface KeywordExtended extends Keyword {
  region?: string;
  language?: string;
  category?: string;
  priority?: 'high' | 'normal' | 'low';
  notes?: string;
}

export interface ExecutionEvent {
  id: string;
  type: string;
  timestamp: string;
  message?: string;
  details?: string;
  error?: string;
  function?: string;
  state_name?: string;
}

export type ExecutionStatus = 'RUNNING' | 'SUCCEEDED' | 'FAILED' | 'TIMED_OUT' | 'ABORTED';

export interface Execution {
  arn: string;
  name: string;
  status: ExecutionStatus;
  start_date: string;
  stop_date?: string;
  events: ExecutionEvent[];
}

export type ScheduleState = 'ENABLED' | 'DISABLED';

export interface Schedule {
  name: string;
  state: ScheduleState;
  schedule: string;
  timezone: string;
  /** Keyword subset this schedule runs. Empty/absent = all active keywords. */
  keywords?: string[];
}

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

export interface ScheduleFormData {
  name: string;
  frequency: ScheduleFrequency;
  time: string;
  timezone: string;
  day_of_week: string;
  day_of_month: string;
  enabled: boolean;
  /** Keyword subset to run. Empty = all active keywords at execution time. */
  keywords: string[];
}
