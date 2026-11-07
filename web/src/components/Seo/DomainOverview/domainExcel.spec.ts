import {
  describe, expect, it
} from 'vitest';
import { excelTableRows } from '../../../exporters/tableExcel';
import {
  buildDomainPages, buildDomainSnapshots, buildRankedKeyword, buildSerpCompetitors
} from '../../../api/seoDomains-fixtures';
import {
  COMPETITOR_EXCEL_COLUMNS, KEYWORD_EXCEL_COLUMNS, PAGE_EXCEL_COLUMNS, SNAPSHOT_EXCEL_COLUMNS
} from './domainExcel';

describe('KEYWORD_EXCEL_COLUMNS', () => {
  it('writes the raw figures, the intent label and the full URL of a ranked keyword', () => {
    expect(excelTableRows(KEYWORD_EXCEL_COLUMNS, [buildRankedKeyword()])).toStrictEqual([{
      'Keyword': 'cheap flights',
      'Intent': 'Commercial',
      'Position': 4,
      'Organic position': 3,
      'Search volume': 2400,
      'Est. traffic': 121,
      'CPC (USD)': 1.25,
      'Keyword difficulty': 37,
      'URL': 'https://example.com/flights',
    }]);
  });

  it('leaves the cells of unknown figures empty instead of writing 0', () => {
    const row = buildRankedKeyword({
      position: null,
      organic_position: null,
      search_volume: null,
      etv: null,
      cpc: null,
      keyword_difficulty: null,
      url: null,
      intent: 'unknown',
    });

    expect(excelTableRows(KEYWORD_EXCEL_COLUMNS, [row])).toStrictEqual([{
      'Keyword': 'cheap flights',
      'Intent': 'Unknown',
      'Position': '',
      'Organic position': '',
      'Search volume': '',
      'Est. traffic': '',
      'CPC (USD)': '',
      'Keyword difficulty': '',
      'URL': '',
    }]);
  });
});

describe('PAGE_EXCEL_COLUMNS', () => {
  it('writes the full URL, estimated traffic and keyword count of a top page', () => {
    expect(excelTableRows(PAGE_EXCEL_COLUMNS, buildDomainPages().items)).toStrictEqual([{
      'URL': 'https://example.com/blog/a',
      'Est. traffic': 13,
      'Keywords': 4,
    }]);
  });
});

describe('COMPETITOR_EXCEL_COLUMNS', () => {
  it('writes every figure of a SERP competitor unrounded', () => {
    expect(excelTableRows(COMPETITOR_EXCEL_COLUMNS, buildSerpCompetitors().items)).toStrictEqual([{
      'Domain': 'acme.example.org',
      'Visibility (0-1)': 0.42,
      'Avg. position': 3.5,
      'Median position': 3,
      'Est. traffic': 640,
      'Keywords': 1,
    }]);
  });
});

describe('SNAPSHOT_EXCEL_COLUMNS', () => {
  it('writes the ISO date and the raw figures of a stored snapshot', () => {
    expect(excelTableRows(SNAPSHOT_EXCEL_COLUMNS, buildDomainSnapshots().snapshots)).toStrictEqual([{
      'Snapshot': '2026-10-19T04:00:00Z',
      'Organic keywords': 1520,
      'Est. traffic / month': 8451,
      'Traffic value / month (USD)': 12034.57,
      'Keywords stored': 1000,
    }]);
  });
});
