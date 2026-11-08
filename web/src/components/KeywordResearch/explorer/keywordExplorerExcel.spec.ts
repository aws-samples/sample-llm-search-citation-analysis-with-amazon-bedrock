import {
  describe, expect, it, vi
} from 'vitest';
import { buildKeywordRow } from '../../../api/seo-fixtures';
import {
  excelTableRows, exportTableToExcel
} from '../../../exporters/tableExcel';
import {
  KEYWORD_EXCEL_COLUMNS, exportKeywordRowsExcel
} from './keywordExplorerExcel';

vi.mock(import('../../../exporters/tableExcel'), async (importOriginal) => ({
  ...await importOriginal(),
  exportTableToExcel: vi.fn(),
}));

describe('keyword Excel columns', () => {
  it('writes every column with its numbers as numbers, CPC and competition to two decimals', () => {
    expect(excelTableRows(KEYWORD_EXCEL_COLUMNS, [buildKeywordRow({
      cpc: 1.256,
      competition: 0.6123,
    })])).toStrictEqual([{
      'Keyword': 'boutique hotel',
      'Volume': 1900,
      'CPC (USD)': 1.26,
      'Competition': 0.61,
      'Difficulty': 42,
      'Intent': 'commercial',
    }]);
  });

  it('leaves unknown metrics empty rather than zero', () => {
    expect(excelTableRows(KEYWORD_EXCEL_COLUMNS, [buildKeywordRow({
      search_volume: null,
      cpc: null,
      competition: null,
      keyword_difficulty: null,
    })])).toStrictEqual([{
      'Keyword': 'boutique hotel',
      'Volume': '',
      'CPC (USD)': '',
      'Competition': '',
      'Difficulty': '',
      'Intent': 'commercial',
    }]);
  });
});

describe('exportKeywordRowsExcel', () => {
  it('exports the rows to a Keywords sheet scoped to the seed', async () => {
    const rows = [buildKeywordRow()];
    await exportKeywordRowsExcel(rows, 'Hotel Zürich');

    const [request] = vi.mocked(exportTableToExcel).mock.calls;

    expect(request).toStrictEqual([{
      columns: KEYWORD_EXCEL_COLUMNS,
      rows,
      sheetName: 'Keywords',
      filePrefix: 'keyword-explorer',
      scopeLabel: 'Hotel Zürich',
    }]);
  });
});
