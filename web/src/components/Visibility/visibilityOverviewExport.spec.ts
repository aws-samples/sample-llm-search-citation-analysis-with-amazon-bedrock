import {
  describe, it, expect
} from 'vitest';
import {
  visibilityOverviewFileName, visibilityOverviewSheets
} from './visibilityOverviewExport';
import {
  BUILT_KPI_CELLS, COMPETITOR_ROW, EMPTY_KPI_CELLS, FIRST_TREND_POINT, KEYWORD_WITHOUT_DATA, buildTrendsResponse, buildVisibility
} from './visibilityOverview-fixtures';
import {
  RUN_2, buildKpis
} from '../Reports/BrandVisibilityReport/groupKpiHistory-fixtures';
import {
  KPI_SPECS, TREND_DEFINITION, VISIBILITY_DEFINITIONS
} from '../../constants/kpiDefinitions';

const CONTEXT_ROW_COUNT = 17;

const sheets = visibilityOverviewSheets(buildVisibility(), buildTrendsResponse(), 'Hotel Sol');
const [summary, definitions, keywords, brands, history] = sheets;
const sheetsWithoutTrends = visibilityOverviewSheets(buildVisibility(), null, 'Hotel Sol');

describe('visibilityOverviewSheets', () => {
  it('builds the summary, definitions, keywords, brands and history sheets in that order', () => {
    expect(sheets.map((sheet) => sheet.name)).toStrictEqual(['Summary', 'Definitions', 'Keywords', 'Brands', 'History']);
  });

  it('opens the summary with the scope, its coverage, sample and history context', () => {
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
    ]);
  });

  it.each([
    ['context rows', summary.data.slice(0, CONTEXT_ROW_COUNT)],
    ['KPI rows when no keyword has an earlier run', visibilityOverviewSheets(buildVisibility({ change: null }), buildTrendsResponse(), 'x')[0].data.slice(CONTEXT_ROW_COUNT)],
  ])('leaves change and trend empty on the %s', (_rows, rows) => {
    expect(new Set(rows.flatMap((row) => [row.Change, row.Trend]))).toStrictEqual(new Set(['']));
  });

  it('lists one summary row per KPI in report order after the context rows', () => {
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
    const row = summary.data.find((candidate) => candidate.Metric === metric);

    expect(row).toStrictEqual({
      Metric: metric,
      Value: value,
      Change: change,
      Trend: trend,
    });
  });

  it('exports an unknown KPI as an empty value cell', () => {
    const [unknownSummary] = visibilityOverviewSheets(buildVisibility({ kpis: buildKpis({ average_position: null }) }), null, 'x');

    expect(unknownSummary.data.find((row) => row.Metric === 'Average position')?.Value).toBe('');
  });

  it('takes the changes from the runs, not from the trend periods', () => {
    const [summaryWithoutPeriods] = visibilityOverviewSheets(buildVisibility(), buildTrendsResponse({ change: null }), 'x');

    expect(summaryWithoutPeriods.data.find((row) => row.Metric === 'Mention rate (%)')?.Change).toBe(-10);
  });

  it('exports empty history context when trends are not loaded', () => {
    expect(sheetsWithoutTrends[0].data.slice(12, 15).map((row) => row.Value)).toStrictEqual(['', '', '']);
  });

  it('exports every visibility definition with how it is measured', () => {
    expect(definitions.data).toStrictEqual(VISIBILITY_DEFINITIONS.map((entry) => ({
      KPI: entry.label,
      'How it is measured': entry.definition,
    })));
  });

  it('ends the definitions with how a change and trend are judged', () => {
    expect(definitions.data[definitions.data.length - 1]).toStrictEqual({
      KPI: TREND_DEFINITION.label,
      'How it is measured': TREND_DEFINITION.definition,
    });
  });

  it('exports an analysed keyword with its latest run and every KPI', () => {
    expect(keywords.data[0]).toStrictEqual({
      Keyword: 'hotel sol spa',
      'Has data': 'Yes',
      'Latest run': RUN_2,
      ...BUILT_KPI_CELLS,
    });
  });

  it('exports a keyword without data with empty run and KPI cells', () => {
    expect(keywords.data[1]).toStrictEqual({
      Keyword: KEYWORD_WITHOUT_DATA.keyword,
      'Has data': 'No',
      'Latest run': '',
      ...EMPTY_KPI_CELLS,
    });
  });

  it('exports the tracked brand of the leaderboard with its engines as one value', () => {
    expect(brands.data[0]).toStrictEqual({
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
    expect(brands.data[1]['Net sentiment (-100 to +100)']).toBe('');
  });

  it('exports unknown brand rates and positions as empty cells', () => {
    const [, , , unknownBrands] = visibilityOverviewSheets(buildVisibility({
      brands: [{
        ...COMPETITOR_ROW,
        mention_rate: null,
        share_of_voice: null,
        average_position: null,
        best_position: null,
      }],
    }), null, 'x');

    expect([
      unknownBrands.data[0]['Mention rate (%)'],
      unknownBrands.data[0]['Share of voice (%)'],
      unknownBrands.data[0]['Average position'],
      unknownBrands.data[0]['Best position'],
    ]).toStrictEqual(['', '', '', '']);
  });

  it('exports one history row per period with its runs, keywords and every KPI', () => {
    expect(history.data[0]).toStrictEqual({
      Period: FIRST_TREND_POINT.period,
      'Analysis runs': 2,
      'Keywords with data': 2,
      ...BUILT_KPI_CELLS,
      'Visibility score (0-100)': 60.6,
    });
  });

  it('exports an empty history sheet when trends are not loaded', () => {
    expect(sheetsWithoutTrends[4].data).toStrictEqual([]);
  });

  it.each([
    ['Summary', 0, 4],
    ['Definitions', 1, 2],
    ['Keywords', 2, 3 + KPI_SPECS.length],
    ['Brands', 3, 11],
    ['History', 4, 3 + KPI_SPECS.length],
  ])('defines one column width per exported field in the %s sheet', (_sheetName, sheetIndex, fieldCount) => {
    const sheet = sheets[sheetIndex];

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
