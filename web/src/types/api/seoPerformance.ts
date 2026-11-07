/**
 * Page performance API (`${SEO_API_BASE_URL}/seo/lighthouse/...` and `/seo/indexnow/...`,
 * `lambda/seo/seo-performance.py`): Lighthouse runs of the brand's own pages and IndexNow submissions.
 * Field names are the API's (snake_case).
 */

export type LighthouseDevice = 'mobile' | 'desktop';

/** Category scores, 0 to 100; `null` when the report has none for that category. */
export interface LighthouseScores {
  performance: number | null;
  accessibility: number | null;
  best_practices: number | null;
  seo: number | null;
}

/** Lab metrics in milliseconds (CLS is unitless); `null` when the run did not measure one. */
export interface LighthouseMetrics {
  lcp_ms: number | null;
  cls: number | null;
  inp_ms: number | null;
  ttfb_ms: number | null;
  fcp_ms: number | null;
  tbt_ms: number | null;
  speed_index_ms: number | null;
}

export type AuditSeverity = 'critical' | 'warning' | 'info';

/** A failed Lighthouse audit: what to fix and roughly what fixing it saves. */
export interface LighthouseAudit {
  id: string;
  category: keyof LighthouseScores;
  title: string;
  description: string;
  display_value: string | null;
  score: number | null;
  savings_ms: number | null;
  savings_bytes: number | null;
  severity: AuditSeverity;
}

export interface LighthouseTarget {
  url: string;
  device: LighthouseDevice;
}

export interface MeasuringResult extends LighthouseTarget {status: 'measuring';}

export interface FailedResult extends LighthouseTarget {
  status: 'failed';
  error: string;
}

export interface CompletedResult extends LighthouseTarget {
  status: 'completed';
  final_url: string;
  lighthouse_version: string | null;
  scores: LighthouseScores;
  metrics: LighthouseMetrics;
  failed_audits: LighthouseAudit[];
  fetched_at: string;
}

export type LighthouseResult = MeasuringResult | FailedResult | CompletedResult;

export type LighthouseRunStatus = 'queued' | 'running' | 'completed' | 'failed';

/** A run as the recent-runs list shows it. */
export interface LighthouseRunHeader {
  run_id: string;
  kind: 'single' | 'batch';
  status: LighthouseRunStatus;
  created_at: string;
  started_by: string | null;
  audit_id: string | null;
  target_count: number;
  first_url: string | null;
}

export interface LighthouseRun extends LighthouseRunHeader {
  updated_at: string | null;
  targets: LighthouseTarget[];
  /** One entry per target, `null` until the run reaches it. */
  results: (LighthouseResult | null)[];
  progress: {
    done: number;
    total: number;
  };
  error: string | null;
}

export interface StartRunResponse {
  run: LighthouseRun;
  /** True when an equal request within 15 minutes already started this run (no new runs were started). */
  reused: boolean;
}

export interface RunResponse {run: LighthouseRun;}

export interface RunsResponse {runs: LighthouseRunHeader[];}

export interface SampleAudit {
  audit_id: string;
  start_url: string | null;
  completed_at: string | null;
  pages_crawled: number | null;
}

/** The pages a batch would measure: the latest finished audit's homepage and one page per URL template. */
export interface LighthouseSample {
  audit: SampleAudit | null;
  pages: string[];
  devices: LighthouseDevice[];
  target_count: number;
}

/** One crawled page of an audit (`GET /seo/audits/{auditId}/pages`); only its URL is read here. */
export interface AuditPageUrl {url: string;}

export interface AuditPagesResponse {pages: AuditPageUrl[];}

export type KeyFileStatus = 'found' | 'missing' | 'wrong_content' | 'redirects' | 'moved' | 'unreachable' | 'unknown';

export interface KeyFileLocation {
  host: string;
  url: string;
}

export interface IndexNowSite {
  domain: string;
  key: string | null;
  /** Where to host the key file (the domain and its `www.` host); empty without a key. */
  key_files: KeyFileLocation[];
}

export interface EngineAnswer {
  engine: 'bing' | 'yandex' | 'yep';
  /** `null` when the engine did not answer. */
  http_status: number | null;
  message: string;
}

export interface HostSubmission {
  host: string;
  url_count: number;
  status: 'submitted' | 'failed' | 'not_sent';
  message: string;
  key_file: KeyFileStatus | null;
  engines: EngineAnswer[];
}

export interface IndexNowSubmission {
  submitted_at: string;
  submitted_by: string;
  source: 'paste' | 'audit';
  url_count: number;
  skipped_count: number;
  skipped_examples: string[];
  hosts: HostSubmission[];
}

export interface IndexNowSetup {
  sites: IndexNowSite[];
  /** The 20 newest submissions, newest first. */
  history: IndexNowSubmission[];
  max_urls: number;
}

export interface CreateKeyResponse {
  site: IndexNowSite;
  created: boolean;
}

export interface KeyFileHostCheck extends KeyFileLocation {
  status: KeyFileStatus;
  problem: string | null;
}

export interface KeyFileCheck {
  domain: string;
  hosts: KeyFileHostCheck[];
}

export interface SubmitResponse {submission: IndexNowSubmission;}

export type SubmitRequest = {
  source: 'paste';
  urls: string[] 
} | { source: 'audit' };
