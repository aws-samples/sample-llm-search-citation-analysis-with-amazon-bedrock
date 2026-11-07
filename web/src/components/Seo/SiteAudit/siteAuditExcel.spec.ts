import {
  describe, expect, it
} from 'vitest';
import {
  PAGE_URL, buildBotAccess, buildIssueTypeEntry
} from '../../../api/seoAudits-fixtures';
import { excelTableRows } from '../../../exporters/tableExcel';
import {
  AI_CRAWLER_COLUMNS, ISSUE_TYPE_COLUMNS, affectedPageColumns, auditHost, issueDetailText
} from './siteAuditExcel';

describe('issue types Excel columns', () => {
  it('writes severity, group, issue, page and occurrence counts as numbers, and how to fix', () => {
    const entry = buildIssueTypeEntry({
      pages: 12,
      issues: 30,
    });

    expect(excelTableRows(ISSUE_TYPE_COLUMNS, [entry])).toStrictEqual([{
      'Severity': 'Critical',
      'Group': 'Content',
      'Issue': 'Missing title tag',
      'Pages': 12,
      'Occurrences': 30,
      'How to fix': 'Add a unique, descriptive <title>.',
    }]);
  });

  it('keeps a title that starts like a formula as plain text', () => {
    const entry = buildIssueTypeEntry({ title: '=HYPERLINK("x")' });

    expect(excelTableRows(ISSUE_TYPE_COLUMNS, [entry])[0]['Issue']).toBe('=HYPERLINK("x")');
  });
});

describe('affected pages Excel columns', () => {
  it('writes the issue, the full page URL and every detail uncut', () => {
    const issue = {
      issue_type: 'missing-title',
      page_url: PAGE_URL,
      details: {
        status_code: 404,
        linked_from: ['https://www.example.com/', 'https://www.example.com/deals'],
      },
    };

    expect(excelTableRows(affectedPageColumns('Broken link'), [issue])).toStrictEqual([{
      'Issue': 'Broken link',
      'Page URL': PAGE_URL,
      'Details': 'status code: 404 · linked from: https://www.example.com/, https://www.example.com/deals',
    }]);
  });

  it('leaves the details empty when the issue has none', () => {
    expect(issueDetailText({})).toBe('');
  });
});

describe('AI crawler Excel columns', () => {
  it('writes the crawler access with its rule, line and blocked paths', () => {
    const bot = buildBotAccess({ blocked_paths: ['/private', '/cart'] });

    expect(excelTableRows(AI_CRAWLER_COLUMNS, [bot])).toStrictEqual([{
      'Crawler': 'GPTBot',
      'Operator': 'OpenAI',
      'Use': 'Model training',
      'Access': 'Blocked',
      'Rule on /': 'Disallow: /',
      'robots.txt line': 4,
      'Blocked paths': '/private /cart',
    }]);
  });

  it('leaves the line empty when no rule matched', () => {
    const bot = buildBotAccess({ line: null });

    expect(excelTableRows(AI_CRAWLER_COLUMNS, [bot])[0]['robots.txt line']).toBe('');
  });
});

describe('auditHost', () => {
  it('reads the host of the start URL without scheme or path', () => {
    expect(auditHost('https://www.example.com/fares?x=1')).toBe('www.example.com');
  });

  it('keeps a bare host as it is', () => {
    expect(auditHost('example.com')).toBe('example.com');
  });
});
