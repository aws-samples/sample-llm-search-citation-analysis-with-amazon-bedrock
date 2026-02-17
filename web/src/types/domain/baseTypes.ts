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
  status?: 'active' | 'inactive';
}

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
}
