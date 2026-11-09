/** Labels and styles of the site audit view. */
import type {
  AuditStatus, BotAccessLevel, BotClass, IssueGroup, IssueSeverity, LlmsTxtState, SiteAudit
} from '../../../types/api/seoAudits';

export const SEVERITY_ORDER: readonly IssueSeverity[] = ['critical', 'warning', 'info'];

export const GROUP_ORDER: readonly IssueGroup[] = ['crawl', 'indexing', 'content', 'links', 'performance', 'ai_readiness'];

export const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  critical: 'Critical',
  warning: 'Warning',
  info: 'Notice',
};

export const SEVERITY_BADGES: Record<IssueSeverity, string> = {
  critical: 'bg-red-50 text-red-700 border-red-200',
  warning: 'bg-gray-50 text-amber-800 border-gray-200',
  info: 'bg-gray-50 text-gray-700 border-gray-200',
};

export const GROUP_LABELS: Record<IssueGroup, string> = {
  crawl: 'Crawlability',
  indexing: 'Indexing',
  content: 'Content',
  links: 'Links and redirects',
  performance: 'Performance',
  ai_readiness: 'AI readiness',
};

export const STATUS_LABELS: Record<AuditStatus, string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

export const BOT_CLASS_LABELS: Record<BotClass, string> = {
  search: 'AI search',
  user_fetch: 'User-triggered fetch',
  training: 'Model training',
};

export const ACCESS_LABELS: Record<BotAccessLevel, string> = {
  allowed: 'Allowed',
  partial: 'Partly blocked',
  blocked: 'Blocked',
};

export const ACCESS_BADGES: Record<BotAccessLevel, string> = {
  allowed: 'bg-gray-50 text-emerald-700 border-gray-200',
  partial: 'bg-gray-50 text-amber-800 border-gray-200',
  blocked: 'bg-red-50 text-red-700 border-red-200',
};

export const LLMS_TXT_LABELS: Record<LlmsTxtState, string> = {
  present: 'Present',
  invalid: 'Present but not valid',
  missing: 'Not published',
  not_checked: 'Not checked (robots.txt keeps the crawler out)',
};

/** "Crawl stopped early" reasons, as the audit record names them. */
const STOP_REASONS: Record<string, string> = {
  rate_limited: 'The site rate-limited the crawler, so the audit stopped early.',
  robots_unreachable: 'robots.txt did not answer, so compliant crawlers treat the site as closed and nothing was crawled.',
};

export function stopReasonText(audit: SiteAudit): string | null {
  return audit.stop_reason ? STOP_REASONS[audit.stop_reason] ?? null : null;
}

/** Minutes a crawl of `pages` pages takes at one request a second (rounded up, at least 1). */
export function crawlMinutes(pages: number): number {
  return Math.max(1, Math.ceil(pages / 60));
}

export function formatAuditDate(iso: string | null): string {
  if (!iso) return '-';
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}
