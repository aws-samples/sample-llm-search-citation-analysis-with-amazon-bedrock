/**
 * Site audit API shapes (`${SEO_API_BASE_URL}/seo/audits...`), one-to-one with `lambda/seo/seo-audits.py`
 * (snake_case). Checked at runtime by `web/src/api/seoAuditsDecoders.ts`.
 */

export type AuditStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
export type IssueSeverity = 'critical' | 'warning' | 'info';
export type IssueGroup = 'crawl' | 'indexing' | 'content' | 'links' | 'performance' | 'ai_readiness';
export type BotClass = 'search' | 'user_fetch' | 'training';
export type BotAccessLevel = 'allowed' | 'partial' | 'blocked';
export type RobotsKind = 'parsed' | 'allow_all' | 'disallow_all';
export type LlmsTxtState = 'present' | 'invalid' | 'missing' | 'not_checked';

export interface SiteAudit {
  audit_id: string;
  start_url: string;
  origin: string | null;
  status: AuditStatus;
  phase: string | null;
  max_pages: number;
  pages_crawled: number;
  pages_total: number | null;
  started_by: string | null;
  started_at: string;
  completed_at: string | null;
  error_code: string | null;
  stop_reason: string | null;
}

export interface IssueTypeCount {
  issue_type: string;
  issues: number;
  pages: number;
}

export interface AuditSummary {
  score: number;
  issues_total: number;
  counts_by_severity: Record<IssueSeverity, number>;
  counts_by_group: Record<IssueGroup, number>;
  issue_types: IssueTypeCount[];
}

export interface BotAccess {
  token: string;
  vendor: string;
  bot_class: BotClass;
  access: BotAccessLevel;
  blocked_paths: string[];
  rule: string;
  line: number | null;
}

export interface AiReadiness {
  robots_status: number;
  robots_kind: RobotsKind;
  bots: BotAccess[];
  llms_txt: LlmsTxtState;
}

export interface SiteAuditDetail extends SiteAudit {
  summary: AuditSummary | null;
  ai_readiness: AiReadiness | null;
}

export interface AuditListResponse {
  audits: SiteAudit[];
  sites: string[];
  max_pages_choices: number[];
}

export interface AuditDetailResponse {audit: SiteAuditDetail;}

export interface StartAuditRequest {
  start_url: string;
  max_pages: number;
}

export interface AuditResponse {audit: SiteAudit;}

export interface IssueDescriptor {
  issue_type: string;
  severity: IssueSeverity;
  group: IssueGroup;
  title: string;
  explanation: string;
  how_to_fix: string;
}

export interface IssueTypeEntry extends IssueDescriptor {
  issues: number;
  pages: number;
}

export interface AuditIssueTypesResponse {
  audit_id: string;
  issue_types: IssueTypeEntry[];
}

export interface AuditIssue {
  issue_type: string;
  page_url: string;
  details: Record<string, unknown>;
}

export interface AuditIssuesResponse {
  audit_id: string;
  issue: IssueDescriptor;
  items: AuditIssue[];
  next_token: string | null;
}
