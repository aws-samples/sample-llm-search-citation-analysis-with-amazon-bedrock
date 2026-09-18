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

/**
 * What a KPI view or report covers. Serialised to the read endpoints' scope
 * query parameters (`keyword=`, `group_id=`, `scope=all`) by
 * `reportScopeParams`; resolved server-side against the active keywords.
 */
export type ReportScope =
  | { kind: 'all' }
  | {
    kind: 'group';
    groupId: string 
  }
  | {
    kind: 'keyword';
    keyword: string 
  };

/** The `scope` block the read endpoints echo back for a group / all answer. */
export interface ReportScopeInfo {
  kind: 'all' | 'group' | 'keywords' | 'keyword';
  label: string;
  keyword_count: number;
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

export type ScheduleFrequency = 'daily' | 'weekly' | 'monthly';

/** The editable timing of a schedule, as stored in its v2 descriptor. */
export interface ScheduleForm {
  frequency: ScheduleFrequency;
  /** HH:MM, 24-hour clock, in `timezone`. */
  time: string;
  /** IANA zone name, e.g. Europe/Madrid. */
  timezone: string;
  day_of_week: string;
  day_of_month: number;
}

/**
 * An automated analysis schedule (EventBridge Scheduler).
 *
 * `id` is the generated, immutable schedule name; `display_name` is what the
 * user typed. `scope` is resolved against the active keywords when the
 * schedule fires. Schedules created before 2.3.0 are `legacy`: their `form`
 * is recovered from the cron expression and a keyword-text schedule has no
 * id-based `scope` (its texts are under `keywords`) until it is re-scoped.
 */
export interface Schedule {
  id: string;
  /** Same as `id`; kept for the previous API shape. */
  name: string;
  display_name: string;
  state: ScheduleState;
  enabled: boolean;
  /** Raw EventBridge expression, e.g. `cron(0 9 ? * MON *)`. */
  schedule: string;
  timezone: string;
  form: ScheduleForm | null;
  scope: AnalysisScope | null;
  scope_summary: string;
  /** Legacy keyword-text subset; empty for v2 schedules. */
  keywords?: string[];
  legacy: boolean;
  description?: string;
  created_at?: string | null;
  updated_at?: string | null;
}

/** Form state for creating or editing a schedule. */
export interface ScheduleFormData {
  display_name: string;
  frequency: ScheduleFrequency;
  time: string;
  timezone: string;
  day_of_week: string;
  /** Kept as text while editing; validated to 1-28 on save. */
  day_of_month: string;
  enabled: boolean;
  scope: AnalysisScope;
}
