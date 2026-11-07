import type {
  AiReadiness,
  AuditIssuesResponse,
  AuditListResponse,
  AuditSummary,
  BotAccess,
  IssueTypeEntry,
  SiteAudit,
  SiteAuditDetail,
} from '../types/api/seoAudits';

export const AUDIT_ID = '0123456789abcdef0123456789abcdef';
export const PAGE_URL = 'https://www.example.com/fares';

export function buildSiteAudit(overrides: Partial<SiteAudit> = {}): SiteAudit {
  return {
    audit_id: AUDIT_ID,
    start_url: 'https://www.example.com/',
    origin: 'https://www.example.com',
    status: 'completed',
    phase: 'done',
    max_pages: 500,
    pages_crawled: 120,
    pages_total: 120,
    started_by: 'admin@example.com',
    started_at: '2026-10-02T08:00:00.000000Z',
    completed_at: '2026-10-02T08:05:00.000000Z',
    error_code: null,
    stop_reason: '',
    ...overrides,
  };
}

export function buildSummary(overrides: Partial<AuditSummary> = {}): AuditSummary {
  return {
    score: 82,
    issues_total: 7,
    counts_by_severity: {
      critical: 1,
      warning: 4,
      info: 2,
    },
    counts_by_group: {
      crawl: 0,
      indexing: 1,
      content: 3,
      links: 1,
      performance: 0,
      ai_readiness: 2,
    },
    issue_types: [{
      issue_type: 'missing-title',
      issues: 1,
      pages: 1,
    }],
    ...overrides,
  };
}

export function buildBotAccess(overrides: Partial<BotAccess> = {}): BotAccess {
  return {
    token: 'GPTBot',
    vendor: 'OpenAI',
    bot_class: 'training',
    access: 'blocked',
    blocked_paths: [],
    rule: 'Disallow: /',
    line: 4,
    ...overrides,
  };
}

export function buildAiReadiness(overrides: Partial<AiReadiness> = {}): AiReadiness {
  return {
    robots_status: 200,
    robots_kind: 'parsed',
    bots: [buildBotAccess(), buildBotAccess({
      token: 'OAI-SearchBot',
      bot_class: 'search',
      access: 'allowed',
      rule: '',
      line: null,
    })],
    llms_txt: 'missing',
    ...overrides,
  };
}

export function buildAuditDetail(overrides: Partial<SiteAuditDetail> = {}): SiteAuditDetail {
  return {
    ...buildSiteAudit(),
    summary: buildSummary(),
    ai_readiness: buildAiReadiness(),
    ...overrides,
  };
}

export function buildIssueTypeEntry(overrides: Partial<IssueTypeEntry> = {}): IssueTypeEntry {
  return {
    issue_type: 'missing-title',
    severity: 'critical',
    group: 'content',
    title: 'Missing title tag',
    explanation: 'The page has no <title>.',
    how_to_fix: 'Add a unique, descriptive <title>.',
    issues: 1,
    pages: 1,
    ...overrides,
  };
}

export function buildListResponse(overrides: Partial<AuditListResponse> = {}): AuditListResponse {
  return {
    audits: [buildSiteAudit()],
    sites: ['example.com'],
    max_pages_choices: [100, 500, 2000],
    ...overrides,
  };
}

export function buildIssuesResponse(overrides: Partial<AuditIssuesResponse> = {}): AuditIssuesResponse {
  const {
    explanation, how_to_fix: howToFix, issue_type: issueType, severity, group, title
  } = buildIssueTypeEntry();
  return {
    audit_id: AUDIT_ID,
    issue: {
      issue_type: issueType,
      severity,
      group,
      title,
      explanation,
      how_to_fix: howToFix,
    },
    items: [{
      issue_type: 'missing-title',
      page_url: PAGE_URL,
      details: {},
    }],
    next_token: null,
    ...overrides,
  };
}
