/**
 * Excel exports of a finished audit's tables: the issue types (Severity, Group, Issue, Pages, Occurrences, How to
 * fix), the pages one issue type affects (Issue, Page URL, Details) and the AI crawler access of robots.txt.
 * Each file is named after the audited site's host.
 */
import {
  type ExcelTableColumn, exportTableToExcel, spaced
} from '../../../exporters/tableExcel';
import type {
  AuditIssue, BotAccess, IssueTypeEntry
} from '../../../types/api/seoAudits';
import {
  ACCESS_LABELS, BOT_CLASS_LABELS, GROUP_LABELS, SEVERITY_LABELS
} from './siteAuditFormat';

/** The host of an audit's start URL ("www.example.com"), its file-name scope. */
export function auditHost(startUrl: string): string {
  return startUrl.replace(/^https?:\/\//i, '').split(/[/?#]/)[0];
}

/** An issue's details in full: `key: value` (lists joined with commas), separated by " · ". */
export function issueDetailText(details: Record<string, unknown>): string {
  return Object.entries(details).map(([key, value]) => {
    const shown = Array.isArray(value) ? value.join(', ') : String(value);
    return `${key.replaceAll('_', ' ')}: ${shown}`;
  }).join(' · ');
}

export const ISSUE_TYPE_COLUMNS: ReadonlyArray<ExcelTableColumn<IssueTypeEntry>> = [
  {
    header: 'Severity',
    value: (entry) => SEVERITY_LABELS[entry.severity],
  },
  {
    header: 'Group',
    value: (entry) => GROUP_LABELS[entry.group],
  },
  {
    header: 'Issue',
    value: (entry) => entry.title,
  },
  {
    header: 'Pages',
    value: (entry) => entry.pages,
  },
  {
    header: 'Occurrences',
    value: (entry) => entry.issues,
  },
  {
    header: 'How to fix',
    value: (entry) => entry.how_to_fix,
  },
];

export function affectedPageColumns(issueTitle: string): ExcelTableColumn<AuditIssue>[] {
  return [
    {
      header: 'Issue',
      value: () => issueTitle,
    },
    {
      header: 'Page URL',
      value: (issue) => issue.page_url,
    },
    {
      header: 'Details',
      value: (issue) => issueDetailText(issue.details),
    },
  ];
}

export const AI_CRAWLER_COLUMNS: ReadonlyArray<ExcelTableColumn<BotAccess>> = [
  {
    header: 'Crawler',
    value: (bot) => bot.token,
  },
  {
    header: 'Operator',
    value: (bot) => bot.vendor,
  },
  {
    header: 'Use',
    value: (bot) => BOT_CLASS_LABELS[bot.bot_class],
  },
  {
    header: 'Access',
    value: (bot) => ACCESS_LABELS[bot.access],
  },
  {
    header: 'Rule on /',
    value: (bot) => bot.rule,
  },
  {
    header: 'robots.txt line',
    value: (bot) => bot.line,
  },
  {
    header: 'Blocked paths',
    value: (bot) => spaced(bot.blocked_paths),
  },
];

export function exportIssueTypesExcel(entries: readonly IssueTypeEntry[], startUrl: string): Promise<void> {
  return exportTableToExcel({
    columns: ISSUE_TYPE_COLUMNS,
    rows: entries,
    sheetName: 'Site audit issues',
    filePrefix: 'site-audit-issues',
    scopeLabel: auditHost(startUrl),
  });
}

export function exportAffectedPagesExcel(issues: readonly AuditIssue[], issueTitle: string, startUrl: string): Promise<void> {
  return exportTableToExcel({
    columns: affectedPageColumns(issueTitle),
    rows: issues,
    sheetName: 'Affected pages',
    filePrefix: 'site-audit-pages',
    scopeLabel: auditHost(startUrl),
  });
}

export function exportAiCrawlersExcel(bots: readonly BotAccess[], startUrl: string): Promise<void> {
  return exportTableToExcel({
    columns: AI_CRAWLER_COLUMNS,
    rows: bots,
    sheetName: 'AI crawler access',
    filePrefix: 'site-audit-ai-crawlers',
    scopeLabel: auditHost(startUrl),
  });
}
