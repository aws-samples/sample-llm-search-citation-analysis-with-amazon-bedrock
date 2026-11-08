import {
  describe, expect, it
} from 'vitest';
import { excelTableRows } from '../../../exporters/tableExcel';
import {
  BEYOND_TOP_ROW, buildSeoGeoResponse, buildSeoGeoRow, NO_DATA_ROW, TRAFFIC_COMPARISON
} from '../../../hooks/useSeoGeo-fixtures';
import {
  SEO_GEO_KEYWORD_COLUMNS, SEO_GEO_TRAFFIC_COLUMNS, seoGeoKeywordsExport, seoGeoTrafficExport
} from './seoGeoExcel';

describe('SEO_GEO_KEYWORD_COLUMNS', () => {
  it('writes every column of a top-10 keyword, numbers as numbers', () => {
    expect(excelTableRows(SEO_GEO_KEYWORD_COLUMNS, [buildSeoGeoRow()])).toStrictEqual([{
      Keyword: 'cheap flights geneva',
      Volume: 12100,
      'Organic position': 3,
      'Ranked position': '',
      'Ranked position source': '',
      'Est. traffic': '',
      'AI Overview shown': 'Yes',
      'AI Overview cites you': 'No',
      'AI mention rate (%)': 20,
      Answers: 5,
      'Citation overlap (%)': 40,
      Quadrant: 'AI gap',
    }]);
  });

  it('writes >10 and the deeper ranked position of a keyword beyond the top 10', () => {
    const [cells] = excelTableRows(SEO_GEO_KEYWORD_COLUMNS, [BEYOND_TOP_ROW]);

    expect([cells?.['Organic position'], cells?.['Ranked position'], cells?.['Ranked position source'], cells?.['Est. traffic']])
      .toStrictEqual(['>10', 14, 'Snapshot', 35]);
  });

  it('leaves the unknown figures of a keyword without data empty, never 0', () => {
    const [cells] = excelTableRows(SEO_GEO_KEYWORD_COLUMNS, [NO_DATA_ROW]);

    expect([cells?.Volume, cells?.['Organic position'], cells?.['AI Overview shown'], cells?.['AI mention rate (%)']])
      .toStrictEqual(['', '', '', '']);
  });

  it('names a rank-tracked position as tracked', () => {
    const [cells] = excelTableRows(SEO_GEO_KEYWORD_COLUMNS, [buildSeoGeoRow({
      organic_position: null,
      ranked_position: 18,
      organic_position_source: 'rank_tracking',
    })]);

    expect([cells?.['Ranked position'], cells?.['Ranked position source']]).toStrictEqual([18, 'Tracked']);
  });
});

describe('SEO_GEO_TRAFFIC_COLUMNS', () => {
  it('writes each brand with its estimated traffic and both shares', () => {
    expect(excelTableRows(SEO_GEO_TRAFFIC_COLUMNS, TRAFFIC_COMPARISON)).toStrictEqual([
      {
        Brand: 'You',
        'Est. traffic': 400,
        'Share of est. search traffic (%)': 40,
        'Share of AI mentions (%)': 50,
      },
      {
        Brand: 'Acme',
        'Est. traffic': 600,
        'Share of est. search traffic (%)': 60,
        'Share of AI mentions (%)': 25,
      },
    ]);
  });
});

describe('SEO vs GEO exports', () => {
  it('names the keyword file after the report scope', () => {
    const table = seoGeoKeywordsExport(buildSeoGeoResponse(), 'Geneva routes');

    expect([table.sheetName, table.filePrefix, table.scopeLabel]).toStrictEqual(['SEO vs GEO keywords', 'seo-vs-geo', 'Geneva routes']);
  });

  it('names the traffic file after the report scope', () => {
    const table = seoGeoTrafficExport(buildSeoGeoResponse(), 'All keywords');

    expect([table.sheetName, table.filePrefix, table.scopeLabel]).toStrictEqual(['SEO vs GEO traffic', 'seo-vs-geo-traffic', 'All keywords']);
  });

  it('names all keywords when a section has no scope label and no group', () => {
    expect(seoGeoKeywordsExport(buildSeoGeoResponse({ group_id: null })).scopeLabel).toBe('All keywords');
  });
});
