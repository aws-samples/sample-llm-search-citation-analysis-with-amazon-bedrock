import {
  describe, expect, it, vi
} from 'vitest';
import {
  exportGroupKpiReport, groupKpiReportFileName, groupKpiReportSheets
} from './groupKpiExport';
import {
  buildHistory, historyWithoutOwnedDomains, RUN_1, RUN_2, RUN_3
} from './groupKpiHistory-fixtures';
import { exportWorkbook } from '../../../exporters/excelGenerator';
import { GROUP_REPORT_DEFINITIONS } from '../../../constants/kpiDefinitions';
import {
  EMPTY_KPI_CELLS, EXPORTED_AT as GENERATED_AT, KPI_CHANGE_HEADERS, KPI_VALUE_HEADERS, kpiChangeCells, kpiValueCells,
  selectedRunSheets, sheetRows, summaryCells, unknownValueSheets
} from './groupKpiExport-fixtures';

vi.mock('../../../exporters/excelGenerator', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../exporters/excelGenerator')>(),
  exportWorkbook: vi.fn(),
}));

const HISTORY = buildHistory();
const SELECTED = HISTORY.runs[1];

/** Every KPI value of RUN_2, in report order. */
const RUN_2_VALUES = [20, 12, 60, 25, 1.8, 40, 55, 52.4, 6, 30, 12.5, 15, 75, 80];

/** Every KPI change from RUN_1 to RUN_2, in report order. */
const RUN_2_CHANGES = [0, -2, -10, 5, 0.5, 3, 1.5, -8.2, 1, 1.2, -2.5, 10, 0.8, -20];

describe('groupKpiReportSheets', () => {
  it('writes the summary, definitions, history, drivers, keyword runs and brand mentions', () => {
    expect(selectedRunSheets().map((entry) => entry.name)).toStrictEqual([
      'Summary', 'Definitions', 'KPI history', 'Drivers', 'Keyword runs', 'Brand mentions (run)',
    ]);
  });

  it('leaves out the brand mentions sheet when they could not be read', () => {
    expect(selectedRunSheets(null).map((entry) => entry.name)).not.toContain('Brand mentions (run)');
  });

  it('gives every column of every sheet a width', () => {
    expect(selectedRunSheets().every((entry) => entry.data.length === 0 || entry.columns.length === Object.keys(entry.data[0]).length)).toBe(true);
  });

  it('writes out every KPI, group run and trend definition', () => {
    expect(sheetRows(selectedRunSheets(), 'Definitions')).toStrictEqual(GROUP_REPORT_DEFINITIONS.map((entry) => ({
      KPI: entry.label,
      'How it is measured': entry.definition,
    })));
  });

  it('attaches one row per brand appearance of the selected run', () => {
    expect(sheetRows(selectedRunSheets(), 'Brand mentions (run)')).toStrictEqual([{
      Keyword: 'hotel sol spa',
      Brand: 'Hotel Sol',
      Classification: 'first_party',
      Provider: 'openai',
      Model: 'gpt-5.2',
      Rank: 1,
      Mentions: 2,
      'First position': 10,
      Sentiment: 'positive',
    }]);
  });
});

describe('groupKpiReportSheets summary', () => {
  it('opens the summary with the context of the selected run', () => {
    expect(summaryCells(1).slice(0, 10)).toStrictEqual([
      ['Keyword group', 'Hotel Sol', '', ''],
      ['Period (days)', 90, '', ''],
      ['Generated at', '2026-09-28T12:00:00.000Z', '', ''],
      ['Run', RUN_2, '', ''],
      ['Group run', 'Yes', '', ''],
      ['Keywords with results', '5 of 5', '', ''],
      ['AI engines', 4, '', ''],
      ['Compared with run', RUN_1, '', ''],
      ['Owned domains configured', 'Yes', '', ''],
      ['Group run threshold (% of keywords)', 50, '', ''],
    ]);
  });

  it('lists every KPI of the selected run with its value, change and trend', () => {
    expect(summaryCells(1).slice(10)).toStrictEqual([
      ['Answers', 20, 0, ''],
      ['Mentions', 12, -2, ''],
      ['Mention rate (%)', 60, -10, 'declining'],
      ['Share of voice (%)', 25, 5, 'improving'],
      ['Average position', 1.8, 0.5, 'declining'],
      ['Top-1 share (%)', 40, 3, 'improving'],
      ['Top-3 share (%)', 55, 1.5, 'stable'],
      ['Visibility score (0-100)', 52.4, -8.2, 'declining'],
      ['Citations', 6, 1, ''],
      ['Citation rate (%)', 30, 1.2, 'stable'],
      ['Citation share (%)', 12.5, -2.5, 'declining'],
      ['Net sentiment (-100 to +100)', 15, 10, 'improving'],
      ['Engine coverage (%)', 75, 0.8, 'stable'],
      ['Keyword coverage (%)', 80, -20, 'declining'],
    ]);
  });

  it('leaves the comparison run, changes and trends empty for a run with nothing to compare', () => {
    const summary = summaryCells(2);

    expect([summary[7][1], ...summary.slice(10).flatMap((row) => row.slice(2))]).toStrictEqual(['', ...EMPTY_KPI_CELLS, ...EMPTY_KPI_CELLS]);
  });

  it('marks a partial run in the summary', () => {
    expect(summaryCells(2)[4]).toStrictEqual(['Group run', 'No', '', '']);
  });

  it('says when owned domains are not configured and leaves the citation KPIs empty', () => {
    const summary = summaryCells(1, historyWithoutOwnedDomains());

    expect(summary[8]).toStrictEqual(['Owned domains configured', 'No', '', '']);
    expect(summary.slice(18, 21).map((row) => row.slice(0, 2))).toStrictEqual([
      ['Citations', ''], ['Citation rate (%)', ''], ['Citation share (%)', ''],
    ]);
  });
});

describe('groupKpiReportSheets KPI history', () => {
  it('heads the history with the run, its coverage, every KPI value, the comparison, every KPI change and the models', () => {
    expect(Object.keys(sheetRows(selectedRunSheets(), 'KPI history')[0])).toStrictEqual([
      'Run', 'Group run', 'Keywords with results', 'Keywords total', ...KPI_VALUE_HEADERS, 'Compared with run', ...KPI_CHANGE_HEADERS, 'Models',
    ]);
  });

  it('lists every run oldest first, partial runs included, with its coverage and models', () => {
    expect(sheetRows(selectedRunSheets(), 'KPI history').map((row) => [row.Run, row['Group run'], row['Keywords with results'], row.Models]))
      .toStrictEqual([[RUN_1, 'Yes', 5, 'openai: gpt-5-mini'], [RUN_2, 'Yes', 5, 'openai: gpt-5.2'], [RUN_3, 'No', 1, 'openai: gpt-5-mini']]);
  });

  it('writes every KPI value of a run', () => {
    expect(kpiValueCells(sheetRows(selectedRunSheets(), 'KPI history')[1])).toStrictEqual(RUN_2_VALUES);
  });

  it('writes every KPI change of a compared run and the run it is compared with', () => {
    const row = sheetRows(selectedRunSheets(), 'KPI history')[1];

    expect([row['Compared with run'], ...kpiChangeCells(row)]).toStrictEqual([RUN_1, ...RUN_2_CHANGES]);
  });

  it('leaves the comparison and every change of an uncompared run empty', () => {
    const row = sheetRows(selectedRunSheets(), 'KPI history')[0];

    expect([row['Compared with run'], ...kpiChangeCells(row)]).toStrictEqual(['', ...EMPTY_KPI_CELLS]);
  });

  it('joins several providers and models in one cell', () => {
    const run = {
      ...SELECTED,
      models: {
        openai: ['a', 'b'],
        gemini: ['c']
      }
    };
    const history = {
      ...HISTORY,
      runs: [run]
    };

    expect(sheetRows(groupKpiReportSheets(history, 'Hotel Sol', run, null, GENERATED_AT), 'KPI history')[0].Models).toBe('openai: a, b; gemini: c');
  });
});

describe('groupKpiReportSheets drivers and keyword runs', () => {
  it('names each driver with its run, comparison, mention change and impacts', () => {
    const [driver] = sheetRows(selectedRunSheets(), 'Drivers');

    expect([driver.Run, driver['Compared with run'], driver.Keyword, driver['Brand mention'], driver['Mention rate impact (pts)'],
      driver['Visibility score impact (pts)']]).toStrictEqual([RUN_2, RUN_1, 'hotel sol spa', 'No longer mentioned', -10, -9]);
  });

  it('writes every KPI change of a driver, an unknown change as an empty cell', () => {
    const [driver] = sheetRows(selectedRunSheets(), 'Drivers');

    expect(kpiChangeCells(driver)).toStrictEqual([0, -2, -50, -25, '', -50, -50, -45, '', '', '', '', '', '']);
  });

  it('lists one driver row per driver of every compared run', () => {
    expect(sheetRows(selectedRunSheets(), 'Drivers')).toHaveLength(1);
  });

  it('lists every keyword run with its keyword and mention change', () => {
    expect(sheetRows(selectedRunSheets(), 'Keyword runs').map((row) => [row.Keyword, row.Run, row['Mention change']])).toStrictEqual([
      ['hotel sol spa', RUN_1, ''], ['hotel sol spa', RUN_2, 'No longer mentioned'],
    ]);
  });

  it('writes every KPI value of a keyword run, an unknown value as an empty cell', () => {
    const row = sheetRows(selectedRunSheets(), 'Keyword runs')[1];

    expect(kpiValueCells(row)).toStrictEqual([4, 0, 0, 0, '', 0, 0, 0, 1, 25, 12.5, '', 75, 80]);
  });

  it('writes every KPI change of a keyword run since the keyword\'s previous run', () => {
    const row = sheetRows(selectedRunSheets(), 'Keyword runs')[1];

    expect(kpiChangeCells(row)).toStrictEqual([0, -2, -50, -25, '', -25, -50, -47.5, 0, 0, '', '', '', '']);
  });

  it('leaves every change of a keyword\'s first run empty', () => {
    expect(kpiChangeCells(sheetRows(selectedRunSheets(), 'Keyword runs')[0])).toStrictEqual(EMPTY_KPI_CELLS);
  });
});

describe('groupKpiReportSheets with unknown values', () => {
  it('leaves unknown history values and changes empty', () => {
    const row = sheetRows(unknownValueSheets(), 'KPI history')[0];

    expect([...kpiValueCells(row), ...kpiChangeCells(row)]).toStrictEqual([...EMPTY_KPI_CELLS, ...EMPTY_KPI_CELLS]);
  });

  it('leaves an unchanged driver mention and unknown driver changes empty', () => {
    const row = sheetRows(unknownValueSheets(), 'Drivers')[0];

    expect([row['Brand mention'], ...kpiChangeCells(row)]).toStrictEqual(['', ...EMPTY_KPI_CELLS]);
  });

  it('dates each driver with its comparison run', () => {
    expect(sheetRows(unknownValueSheets(), 'Drivers')[0]['Compared with run']).toBe(RUN_1);
  });

  it('names a gained keyword mention and leaves its unknown values empty', () => {
    const row = sheetRows(unknownValueSheets(), 'Keyword runs')[0];

    expect([row['Mention change'], ...kpiValueCells(row)]).toStrictEqual(['Now mentioned', ...EMPTY_KPI_CELLS]);
  });

  it('leaves unknown summary values and changes empty even for a compared run', () => {
    const summary = sheetRows(unknownValueSheets(), 'Summary').slice(10);

    expect(summary.map((row) => [row.Value, row.Change])).toStrictEqual(EMPTY_KPI_CELLS.map(() => ['', '']));
  });
});

describe('exportGroupKpiReport', () => {
  it('names the file after the group and the date', () => {
    expect(groupKpiReportFileName('Hotel Sol', GENERATED_AT)).toBe('group-visibility-report-hotel-sol-2026-09-28.xlsx');
  });

  it('writes the workbook under that name', async () => {
    await exportGroupKpiReport(HISTORY, 'Hotel Sol', SELECTED, null, GENERATED_AT);

    expect(exportWorkbook).toHaveBeenCalledWith(selectedRunSheets(null), 'group-visibility-report-hotel-sol-2026-09-28.xlsx');
  });
});
