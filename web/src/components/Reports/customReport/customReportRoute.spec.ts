import {
  describe, expect, it
} from 'vitest';
import {
  customReportDays, customReportEditPath, customReportPath, customReportViewPath, type ReportViewSettings
} from './customReportRoute';

const ALL_VIEW = {
  scope: { kind: 'all' },
  days: 90,
  competitor: null,
} satisfies ReportViewSettings;

describe('custom report paths', () => {
  it('encodes the report id in its path', () => {
    expect(customReportPath('a b')).toBe('/reports/custom/a%20b');
  });

  it('puts the editor under the report path', () => {
    expect(customReportEditPath('report-1')).toBe('/reports/custom/report-1/edit');
  });

  it('leaves the saved period and every keyword out of the view path', () => {
    expect(customReportViewPath('report-1', 90, ALL_VIEW)).toBe('/reports/custom/report-1');
  });

  it('carries a keyword, another period and a competitor in the view path', () => {
    expect(customReportViewPath('report-1', 90, {
      scope: {
        kind: 'keyword',
        keyword: 'beach hotel',
      },
      days: 30,
      competitor: 'Hotel Sol',
    })).toBe('/reports/custom/report-1?keyword=beach+hotel&days=30&competitor=Hotel+Sol');
  });

  it('carries a keyword group in the view path', () => {
    expect(customReportViewPath('report-1', 90, {
      scope: {
        kind: 'group',
        groupId: 'group-coruna',
      },
      days: 90,
      competitor: null,
    })).toBe('/reports/custom/report-1?group=group-coruna');
  });

  it('keeps the market of the view in its path', () => {
    expect(customReportViewPath('report-1', 90, ALL_VIEW, 'cl-es')).toBe('/reports/custom/report-1?market=cl-es');
  });
});

describe('customReportDays', () => {
  it('reads an offered period from the URL', () => {
    expect(customReportDays(new URLSearchParams('days=180'), 90)).toBe(180);
  });

  it('falls back to the saved period for a period the reports do not offer', () => {
    expect(customReportDays(new URLSearchParams('days=60'), 30)).toBe(30);
  });

  it('falls back to the saved period when the URL has none', () => {
    expect(customReportDays(new URLSearchParams(''), 180)).toBe(180);
  });
});
