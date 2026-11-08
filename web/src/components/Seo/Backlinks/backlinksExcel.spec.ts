import {
  describe, expect, it, vi
} from 'vitest';
import {
  buildBacklinkRow, buildReferringDomainRow, buildTopPageRow
} from '../../../api/seoBacklinks-fixtures';
import { exportToExcel } from '../../../exporters/excelGenerator';
import { excelTableRows } from '../../../exporters/tableExcel';
import { freezeClockAt } from '../../../test/frozenClock';
import {
  BACKLINKS_EXCEL_COLUMNS, exportBacklinksExcel
} from './backlinksExcel';

vi.mock(import('../../../exporters/excelGenerator'), async (importOriginal) => ({
  ...await importOriginal(),
  exportToExcel: vi.fn(),
}));

describe('backlinks Excel columns', () => {
  it('writes every backlinks column as its raw value, flags as Yes / No and rel attributes spaced', () => {
    const row = buildBacklinkRow({ rel_attributes: ['nofollow', 'ugc'] });

    expect(excelTableRows(BACKLINKS_EXCEL_COLUMNS.backlinks, [row])).toStrictEqual([{
      'Domain': 'blog.example.org',
      'Source URL': 'https://blog.example.org/review',
      'Target URL': 'https://example.com/pricing',
      'Anchor': 'Example pricing',
      'Type': 'anchor',
      'Dofollow': 'Yes',
      'Rel Attributes': 'nofollow ugc',
      'Domain Rank': 55,
      'Source Page Rank': 18,
      'Link Rank': 22,
      'Spam Score': 0,
      'First Seen': '2026-08-01 10:00:00 +00:00',
      'Last Seen': '2026-09-30 10:00:00 +00:00',
      'Lost': 'No',
      'Broken': 'No',
      'Links Count': 1,
    }]);
  });

  it('leaves an unknown spam score and dofollow flag empty rather than zero or No', () => {
    const [record] = excelTableRows(BACKLINKS_EXCEL_COLUMNS.backlinks, [buildBacklinkRow({
      spam_score: null,
      dofollow: null,
    })]);

    expect([record['Spam Score'], record.Dofollow]).toStrictEqual(['', '']);
  });

  it('keeps an anchor starting with a formula character as plain text', () => {
    const [record] = excelTableRows(BACKLINKS_EXCEL_COLUMNS.backlinks, [buildBacklinkRow({ anchor: '=HYPERLINK("x")' })]);

    expect(record.Anchor).toBe('=HYPERLINK("x")');
  });

  it('writes every referring domains column as its raw value', () => {
    expect(excelTableRows(BACKLINKS_EXCEL_COLUMNS.referring_domains, [buildReferringDomainRow()])).toStrictEqual([{
      'Domain': 'blog.example.org',
      'Backlinks': 14,
      'Referring Pages': 9,
      'Rank': 55,
      'Spam Score': 12,
      'First Seen': '2025-02-01 00:00:00 +00:00',
      'Broken Backlinks': 1,
      'Broken Pages': 0,
    }]);
  });

  it('writes every top pages column as its raw value', () => {
    expect(excelTableRows(BACKLINKS_EXCEL_COLUMNS.top_pages, [buildTopPageRow()])).toStrictEqual([{
      'Page': 'https://example.com/pricing',
      'Backlinks': 300,
      'Referring Domains': 41,
      'Rank': 30,
      'Broken Backlinks': 2,
    }]);
  });
});

describe('exportBacklinksExcel', () => {
  freezeClockAt('2026-10-22T09:00:00Z');

  it('writes the referring domains page to a sheet named after the tab', async () => {
    await exportBacklinksExcel('referring_domains', [buildReferringDomainRow()], 'example.com/blog');
    const written = vi.mocked(exportToExcel).mock.lastCall?.[0];

    expect([written?.sheetName, written?.data[0].Domain]).toStrictEqual(['Referring domains', 'blog.example.org']);
  });

  it('names the file after the tab, the target and the UTC date', async () => {
    await exportBacklinksExcel('top_pages', [buildTopPageRow()], 'Example.com/Blog');

    expect(vi.mocked(exportToExcel).mock.lastCall?.[0].fileName).toBe('backlinks-top-pages-example-com-blog-2026-10-22.xlsx');
  });
});
