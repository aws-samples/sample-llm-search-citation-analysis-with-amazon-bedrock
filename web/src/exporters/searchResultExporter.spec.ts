import {
  describe, expect, it
} from 'vitest';
import {
  searchExcelRows, type ExportableSearch
} from './searchResultExporter';

const SEARCH: ExportableSearch = {
  keyword: 'best hotels in madrid',
  provider: 'openai',
  timestamp: '2026-03-01T10:00:00Z',
};

const LOCAL_TIMESTAMP = new Date(SEARCH.timestamp).toLocaleString();

describe('searchExcelRows', () => {
  it('numbers one row per citation from 1 in citation order', () => {
    const rows = searchExcelRows({
      ...SEARCH,
      citations: ['https://a.example/', 'https://b.example/'],
    });

    expect(rows).toStrictEqual([
      {
        Keyword: 'best hotels in madrid',
        Provider: 'openai',
        Timestamp: LOCAL_TIMESTAMP,
        'Citation #': 1,
        'Citation URL': 'https://a.example/',
      },
      {
        Keyword: 'best hotels in madrid',
        Provider: 'openai',
        Timestamp: LOCAL_TIMESTAMP,
        'Citation #': 2,
        'Citation URL': 'https://b.example/',
      },
    ]);
  });

  it.each([
    ['has an empty citation list', []],
    ['has no citation list', undefined],
  ])('writes a single "No citations" row numbered 0 when the search %s', (_condition, citations) => {
    expect(searchExcelRows({
      ...SEARCH,
      citations,
    })).toStrictEqual([{
      Keyword: 'best hotels in madrid',
      Provider: 'openai',
      Timestamp: LOCAL_TIMESTAMP,
      'Citation #': 0,
      'Citation URL': 'No citations',
    }]);
  });
});
