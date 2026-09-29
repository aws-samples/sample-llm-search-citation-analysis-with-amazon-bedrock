import {
  afterEach, describe, it, expect, vi
} from 'vitest';
import {
  exportVisibilityOverview, visibilityOverviewFileName, visibilityOverviewSheets
} from './visibilityOverviewExport';
import {
  BUILT_KPI_CELLS, COMPETITOR_ROW, EMPTY_KPI_CELLS, FIRST_TREND_POINT, KEYWORD_WITHOUT_DATA, buildTrendsResponse, buildVisibility
} from './visibilityOverview-fixtures';
import {
  buildOverviewSheets, summaryRow
} from './visibilityOverviewExport-fixtures';
import {
  RUN_2, buildKpis
} from '../Reports/BrandVisibilityReport/groupKpiHistory-fixtures';
import {
  buildEngineKpis, buildSourceRow
} from '../Reports/layout/reportPayload-fixtures';
import {
  KPI_SPECS, TREND_DEFINITION, VISIBILITY_DEFINITIONS
} from '../../constants/kpiDefinitions';
import { exportWorkbook } from '../../exporters/excelGenerator';
import type { VisibilityResponse } from '../../types';

vi.mock('../../exporters/excelGenerator', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../exporters/excelGenerator')>(),
  exportWorkbook: vi.fn(),
}));

const CONTEXT_ROW_COUNT = 18;

describe('visibilityOverviewSheets', () => {
  it('builds the summary, definitions, keywords, brands, engines, sources and history sheets in that order', () => {
    const sheets = visibilityOverviewSheets(buildVisibility(), buildTrendsResponse(), 'Hotel Sol');

    expect(sheets.map((sheet) => sheet.name)).toStrictEqual(['Summary', 'Definitions', 'Keywords', 'Brands', 'Engines', 'Sources', 'History']);
  });

  it('opens the summary with the scope, its coverage, sample and history context', () => {
    const { summary } = buildOverviewSheets();

    expect(summary.data.slice(0, CONTEXT_ROW_COUNT).map((row) => [row.Metric, row.Value])).toStrictEqual([
      ['Scope', 'Hotel Sol'],
      ['Latest run', RUN_2],
      ['Keywords analysed', 2],
      ['Keywords with data', 1],
      ['Keywords truncated', 'No'],
      ['Owned domains configured', 'Yes'],
      ['AI engines', 4],
      ['Keywords answered', 5],
      ['Positive mentions', 5],
      ['Neutral mentions', 4],
      ['Negative mentions', 1],
      ['Mixed mentions', 2],
      ['History period (days)', 30],
      ['History since', '2026-08-16'],
      ['History grouped per', 'day'],
      ['Change compared with', 'Each keyword\'s previous run'],
      ['Keywords compared', 1],
      ['Cited domains', 3],
    ]);
  });

  it.each<[string, Partial<VisibilityResponse>, number, number]>([
    ['context rows', {}, 0, CONTEXT_ROW_COUNT],
    ['KPI rows when no keyword has an earlier run', { change: null }, CONTEXT_ROW_COUNT, CONTEXT_ROW_COUNT + KPI_SPECS.length],
  ])('leaves change and trend empty on the %s', (_rows, overrides, start, end) => {
    const { summary } = buildOverviewSheets(buildVisibility(overrides));

    expect(new Set(summary.data.slice(start, end).flatMap((row) => [row.Change, row.Trend]))).toStrictEqual(new Set(['']));
  });

  it('lists one summary row per KPI in report order after the context rows', () => {
    const { summary } = buildOverviewSheets();

    expect(summary.data.slice(CONTEXT_ROW_COUNT).map((row) => row.Metric)).toStrictEqual(Object.keys(BUILT_KPI_CELLS));
  });

  it.each([
    ['Mention rate (%)', 60, -10, 'declining'],
    ['Share of voice (%)', 25, 5, 'improving'],
    ['Average position', 1.8, 0.5, 'declining'],
    ['Visibility score (0-100)', 52.4, -8.2, 'declining'],
    ['Citation rate (%)', 30, 1.2, 'stable'],
    ['Net sentiment (-100 to +100)', 15, 10, 'improving'],
    ['Answers', 20, 0, ''],
  ])('exports %s with value %s, change %s and trend "%s"', (metric, value, change, trend) => {
    expect(summaryRow(buildOverviewSheets(), metric)).toStrictEqual({
      Metric: metric,
      Value: value,
      Change: change,
      Trend: trend,
    });
  });

  it('exports an unknown KPI as an empty value cell', () => {
    const sheets = buildOverviewSheets(buildVisibility({ kpis: buildKpis({ average_position: null }) }), null);

    expect(summaryRow(sheets, 'Average position')?.Value).toBe('');
  });

  it('takes the changes from the runs, not from the trend periods', () => {
    const sheets = buildOverviewSheets(buildVisibility(), buildTrendsResponse({ change: null }));

    expect(summaryRow(sheets, 'Mention rate (%)')?.Change).toBe(-10);
  });

  it.each<[string, string, Partial<VisibilityResponse>]>([
    ['Latest run', 'no keyword of the scope has a run', { timestamp: null }],
    ['Keywords compared', 'no keyword has an earlier run', { change: null }],
  ])('exports an empty %s cell when %s', (metric, _condition, overrides) => {
    expect(summaryRow(buildOverviewSheets(buildVisibility(overrides)), metric)?.Value).toBe('');
  });

  it('exports empty history context when trends are not loaded', () => {
    const { summary } = buildOverviewSheets(buildVisibility(), null);

    expect(summary.data.slice(12, 15).map((row) => row.Value)).toStrictEqual(['', '', '']);
  });

  it('exports every visibility definition with how it is measured', () => {
    expect(buildOverviewSheets().definitions.data).toStrictEqual(VISIBILITY_DEFINITIONS.map((entry) => ({
      KPI: entry.label,
      'How it is measured': entry.definition,
    })));
  });

  it('ends the definitions with how a change and trend are judged', () => {
    const { definitions } = buildOverviewSheets();

    expect(definitions.data[definitions.data.length - 1]).toStrictEqual({
      KPI: TREND_DEFINITION.label,
      'How it is measured': TREND_DEFINITION.definition,
    });
  });

  it('exports an analysed keyword with its latest run and every KPI', () => {
    expect(buildOverviewSheets().keywords.data[0]).toStrictEqual({
      Keyword: 'hotel sol spa',
      'Has data': 'Yes',
      'Latest run': RUN_2,
      ...BUILT_KPI_CELLS,
    });
  });

  it('exports a keyword without data with empty run and KPI cells', () => {
    expect(buildOverviewSheets().keywords.data[1]).toStrictEqual({
      Keyword: KEYWORD_WITHOUT_DATA.keyword,
      'Has data': 'No',
      'Latest run': '',
      ...EMPTY_KPI_CELLS,
    });
  });

  it('exports the tracked brand of the leaderboard with its engines as one value', () => {
    expect(buildOverviewSheets().brands.data[0]).toStrictEqual({
      Brand: 'Hotel Sol',
      Type: 'first_party',
      'Visibility score (0-100)': 52.4,
      Mentions: 12,
      'Mention rate (%)': 60,
      'Share of voice (%)': 25,
      'Average position': 1.8,
      'Best position': 1,
      'Net sentiment (-100 to +100)': 15,
      'AI engines': 'gemini, openai',
      Keywords: 2,
    });
  });

  it('exports an unknown competitor sentiment as an empty cell', () => {
    expect(buildOverviewSheets().brands.data[1]['Net sentiment (-100 to +100)']).toBe('');
  });

  it('exports unknown brand rates and positions as empty cells', () => {
    const { brands } = buildOverviewSheets(buildVisibility({
      brands: [{
        ...COMPETITOR_ROW,
        mention_rate: null,
        share_of_voice: null,
        average_position: null,
        best_position: null,
      }],
    }), null);

    expect([
      brands.data[0]['Mention rate (%)'],
      brands.data[0]['Share of voice (%)'],
      brands.data[0]['Average position'],
      brands.data[0]['Best position'],
    ]).toStrictEqual(['', '', '', '']);
  });

  it('exports every KPI of each AI engine, one row per engine in the API order', () => {
    expect(buildOverviewSheets().engines.data).toStrictEqual([
      {
        'AI engine': 'openai',
        ...BUILT_KPI_CELLS,
        Mentions: 7,
        Answers: 10,
        'Mention rate (%)': 70,
        'Visibility score (0-100)': 58,
        'Citation rate (%)': 40,
      },
      {
        'AI engine': 'perplexity',
        ...BUILT_KPI_CELLS,
        Mentions: 5,
        Answers: 10,
        'Mention rate (%)': 50,
        'Visibility score (0-100)': 46.8,
        'Citation rate (%)': 20,
      },
    ]);
  });

  it('exports an unknown engine KPI as an empty cell', () => {
    const { engines } = buildOverviewSheets(buildVisibility({ engines: [buildEngineKpis('openai', { average_position: null })] }), null);

    expect(engines.data[0]['Average position']).toBe('');
  });

  it('exports an owned cited domain with every column of the domains table', () => {
    expect(buildOverviewSheets().sources.data[1]).toStrictEqual({
      Domain: 'hotelsol.com',
      Owned: 'Yes',
      Citations: 6,
      'Citation rate (%)': 30,
      'Citation share (%)': 35.3,
      'AI engines': 'openai, perplexity',
      Keywords: 2,
    });
  });

  it('exports the cited domains most cited first, marking the ones not owned', () => {
    expect(buildOverviewSheets().sources.data.map((row) => [row.Domain, row.Owned])).toStrictEqual([
      ['booking.com', 'No'],
      ['hotelsol.com', 'Yes'],
      ['tripadvisor.com', 'No'],
    ]);
  });

  it('exports unknown domain citation rates and shares as empty cells', () => {
    const { sources } = buildOverviewSheets(buildVisibility({
      sources: [buildSourceRow('blog.example', {
        citation_rate: null,
        citation_share: null,
      })],
    }), null);

    expect([sources.data[0]['Citation rate (%)'], sources.data[0]['Citation share (%)']]).toStrictEqual(['', '']);
  });

  it('exports one history row per period with its runs, keywords and every KPI', () => {
    expect(buildOverviewSheets().history.data[0]).toStrictEqual({
      Period: FIRST_TREND_POINT.period,
      'Analysis runs': 2,
      'Keywords with data': 2,
      ...BUILT_KPI_CELLS,
      'Visibility score (0-100)': 60.6,
    });
  });

  it('exports an empty history sheet when trends are not loaded', () => {
    expect(buildOverviewSheets(buildVisibility(), null).history.data).toStrictEqual([]);
  });

  it.each([
    ['Summary', 0, 4],
    ['Definitions', 1, 2],
    ['Keywords', 2, 3 + KPI_SPECS.length],
    ['Brands', 3, 11],
    ['Engines', 4, 1 + KPI_SPECS.length],
    ['Sources', 5, 7],
    ['History', 6, 3 + KPI_SPECS.length],
  ])('defines one column width per exported field in the %s sheet', (_sheetName, sheetIndex, fieldCount) => {
    const sheet = visibilityOverviewSheets(buildVisibility(), buildTrendsResponse(), 'Hotel Sol')[sheetIndex];

    expect(Object.keys(sheet.data[0])).toHaveLength(fieldCount);
    expect(sheet.columns).toHaveLength(fieldCount);
  });
});

describe('visibilityOverviewFileName', () => {
  it('slugs the scope label and dates the file', () => {
    expect(visibilityOverviewFileName('Hotel Coruña — weekly', new Date('2026-09-18T12:00:00Z'))).toBe('visibility-hotel-coru-a-weekly-2026-09-18.xlsx');
  });

  it('falls back to keywords when scope label has no slug characters', () => {
    expect(visibilityOverviewFileName('', new Date('2026-09-18T12:00:00Z'))).toBe('visibility-keywords-2026-09-18.xlsx');
  });
});

describe('exportVisibilityOverview', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes every sheet to a file named after the scope and dated today', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-18T12:00:00Z'));

    await exportVisibilityOverview(buildVisibility(), null, 'Hotel Sol');

    expect(exportWorkbook).toHaveBeenCalledWith(visibilityOverviewSheets(buildVisibility(), null, 'Hotel Sol'), 'visibility-hotel-sol-2026-09-18.xlsx');
  });
});
