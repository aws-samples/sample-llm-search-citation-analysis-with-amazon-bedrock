import {
  describe, expect, it, vi
} from 'vitest';
import { exportToExcel } from './excelGenerator';
import {
  excelColumnWidths, excelTableRows, exportTableToExcel, rounded, spaced, yesNo, type ExcelTableColumn
} from './tableExcel';
import { freezeClockAt } from '../test/frozenClock';

vi.mock('./excelGenerator', async (importOriginal) => ({
  ...await importOriginal<typeof import('./excelGenerator')>(),
  exportToExcel: vi.fn(),
}));

interface Row {
  readonly name: string;
  readonly volume: number | null;
}

const COLUMNS: ReadonlyArray<ExcelTableColumn<Row>> = [
  {
    header: 'Name',
    value: (row) => row.name,
  },
  {
    header: 'Volume',
    value: (row) => row.volume,
  },
];

describe('excelTableRows', () => {
  it('keys each row by the headers and keeps numbers as numbers', () => {
    expect(excelTableRows(COLUMNS, [{
      name: 'hotels',
      volume: 1200,
    }])).toStrictEqual([{
      Name: 'hotels',
      Volume: 1200,
    }]);
  });

  it('writes an unknown value as an empty cell, never as 0', () => {
    expect(excelTableRows(COLUMNS, [{
      name: 'x',
      volume: null,
    }])[0].Volume).toBe('');
  });

  it('keeps text that looks like a formula as it is', () => {
    expect(excelTableRows(COLUMNS, [{
      name: '=cmd',
      volume: 1,
    }])[0].Name).toBe('=cmd');
  });
});

describe('cell wording', () => {
  it.each([[true, 'Yes'], [false, 'No'], [null, null]])('words the flag %s as %s', (flag, text) => {
    expect(yesNo(flag)).toBe(text);
  });

  it('writes a list space-separated', () => {
    expect(spaced(['nofollow', 'ugc'])).toBe('nofollow ugc');
  });

  it('writes a missing list as an empty cell', () => {
    expect(spaced(null)).toBe('');
  });

  it('rounds a DataForSEO float to the given decimals', () => {
    expect(rounded(1.850000023841858, 2)).toBeCloseTo(1.85, 10);
  });

  it('rounds to a whole number with no decimals', () => {
    expect(rounded(60478.02734375, 0)).toBe(60478);
  });

  it.each([[null], [undefined], [Number.NaN]])('keeps an unknown value (%s) unknown', (value) => {
    expect(rounded(value, 2)).toBeNull();
  });
});

describe('excelColumnWidths', () => {
  it('fits the longest header or cell plus two characters', () => {
    expect(excelColumnWidths(['Name'], [{ Name: 'boutique hotels lisbon' }])).toStrictEqual([{ wch: 24 }]);
  });

  it('never goes under eight characters', () => {
    expect(excelColumnWidths(['#'], [{ '#': 1 }])).toStrictEqual([{ wch: 8 }]);
  });

  it('caps a very long cell at sixty characters', () => {
    expect(excelColumnWidths(['URL'], [{ URL: 'x'.repeat(300) }])).toStrictEqual([{ wch: 60 }]);
  });
});

describe('exportTableToExcel', () => {
  freezeClockAt('2026-10-22T09:00:00Z');

  it('names the file after the prefix, the scope and the UTC date', async () => {
    await exportTableToExcel({
      columns: COLUMNS,
      rows: [],
      sheetName: 'Top keywords',
      filePrefix: 'domain-keywords',
      scopeLabel: 'Example.com',
    });

    expect(vi.mocked(exportToExcel).mock.lastCall?.[0].fileName).toBe('domain-keywords-example-com-2026-10-22.xlsx');
  });
});
