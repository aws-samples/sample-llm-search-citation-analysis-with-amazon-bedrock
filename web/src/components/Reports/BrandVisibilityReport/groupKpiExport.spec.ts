import {
  describe, expect, it, vi
} from 'vitest';
import {
  exportGroupKpiReport, groupKpiReportFileName, groupKpiReportSheets
} from './groupKpiExport';
import {
  buildHistory, buildSummary, RUN_1, RUN_2, RUN_3
} from './groupKpiHistory-fixtures';
import { exportWorkbook } from '../../../exporters/excelGenerator';
import { VISIBILITY_KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';
import {
  EXPORTED_AT as GENERATED_AT, selectedRunSheets, sheetRows, unknownValueSheets
} from './groupKpiExport-fixtures';

vi.mock('../../../exporters/excelGenerator', async (importOriginal) => ({
  ...await importOriginal<typeof import('../../../exporters/excelGenerator')>(),
  exportWorkbook: vi.fn(),
}));

const HISTORY = buildHistory();
const SELECTED = HISTORY.runs[1];

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

  it('summarises the selected run with its changes', () => {
    expect(sheetRows(selectedRunSheets(), 'Summary')).toStrictEqual([
      {
        Metric: 'Keyword group',
        Value: 'Hotel Sol' 
      },
      {
        Metric: 'Period (days)',
        Value: 90 
      },
      {
        Metric: 'Generated at',
        Value: '2026-09-28T12:00:00.000Z' 
      },
      {
        Metric: 'Run',
        Value: RUN_2 
      },
      {
        Metric: 'Group run',
        Value: 'Yes' 
      },
      {
        Metric: 'Keywords with results',
        Value: '5 of 5' 
      },
      {
        Metric: 'Compared with run',
        Value: RUN_1 
      },
      {
        Metric: 'Citation rate (%)',
        Value: 60 
      },
      {
        Metric: 'Citation rate change (pts)',
        Value: -20 
      },
      {
        Metric: 'Share of voice (%)',
        Value: 25 
      },
      {
        Metric: 'Share of voice change (pts)',
        Value: -10 
      },
      {
        Metric: 'Prominence: rank #1 share (%)',
        Value: 40 
      },
      {
        Metric: 'Rank #1 share change (pts)',
        Value: 5 
      },
      {
        Metric: 'Prominence: top-3 share (%)',
        Value: 70 
      },
      {
        Metric: 'Top-3 share change (pts)',
        Value: 0 
      },
      {
        Metric: 'Prominence: mean rank',
        Value: 1.8 
      },
      {
        Metric: 'Mean rank change',
        Value: 0.5 
      },
      {
        Metric: 'Group run threshold (% of keywords)',
        Value: 50 
      },
    ]);
  });

  it('leaves the changes empty for a run with nothing to compare', () => {
    const summary = groupKpiReportSheets(HISTORY, 'Hotel Sol', HISTORY.runs[2], null, GENERATED_AT)[0].data;

    expect(summary.filter((row) => String(row.Metric).includes('change') || row.Metric === 'Compared with run').map((row) => row.Value))
      .toStrictEqual(['', '', '', '', '', '']);
  });

  it('marks a partial run in the summary', () => {
    const summary = groupKpiReportSheets(HISTORY, 'Hotel Sol', HISTORY.runs[2], null, GENERATED_AT)[0].data;

    expect(summary[4]).toStrictEqual({
      Metric: 'Group run',
      Value: 'No' 
    });
  });

  it('writes an unknown mean rank as an empty cell', () => {
    const run = {
      ...SELECTED,
      summary: buildSummary({ mean_rank: null }) 
    };

    expect(groupKpiReportSheets(HISTORY, 'Hotel Sol', run, null, GENERATED_AT)[0].data[15]).toStrictEqual({
      Metric: 'Prominence: mean rank',
      Value: '' 
    });
  });

  it('writes out every KPI definition', () => {
    expect(sheetRows(selectedRunSheets(), 'Definitions')).toStrictEqual(VISIBILITY_KPI_DEFINITIONS.map((entry) => ({
      KPI: entry.label,
      'How it is measured': entry.definition,
    })));
  });

  it('lists every run with its KPIs, changes and models', () => {
    expect(sheetRows(selectedRunSheets(), 'KPI history')[1]).toStrictEqual({
      Run: RUN_2,
      'Group run': 'Yes',
      'Keywords with results': 5,
      'Keywords total': 5,
      'Citation rate (%)': 60,
      'Share of voice (%)': 25,
      'Rank #1 share (%)': 40,
      'Top-3 share (%)': 70,
      'Mean rank': 1.8,
      'Compared with run': RUN_1,
      'Citation rate change (pts)': -20,
      'Share of voice change (pts)': -10,
      'Rank #1 share change (pts)': 5,
      'Mean rank change': 0.5,
      Models: 'openai: gpt-5.2',
    });
  });

  it('lists runs oldest first, partial runs included', () => {
    expect(sheetRows(selectedRunSheets(), 'KPI history').map((row) => [row.Run, row['Group run']])).toStrictEqual([[RUN_1, 'Yes'], [RUN_2, 'Yes'], [RUN_3, 'No']]);
  });

  it('leaves the changes of an uncompared run empty', () => {
    const first = sheetRows(selectedRunSheets(), 'KPI history')[0];

    expect([first['Compared with run'], first['Citation rate change (pts)'], first['Mean rank change']]).toStrictEqual(['', '', '']);
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

    expect(groupKpiReportSheets(history, 'Hotel Sol', run, null, GENERATED_AT)[2].data[0].Models).toBe('openai: a, b; gemini: c');
  });

  it('lists every driver of every run', () => {
    expect(sheetRows(selectedRunSheets(), 'Drivers')).toStrictEqual([{
      Run: RUN_2,
      'Compared with run': RUN_1,
      Keyword: 'hotel sol spa',
      'Hotel mention': 'No longer mentioned',
      'Citation rate impact (pts)': -20,
      'Share of voice change (pts)': -50,
      'SOV impact (pts)': -10,
      'Rank #1 share change (pts)': -100,
      'Top-3 share change (pts)': -100,
      'Mean rank change': '',
    }]);
  });

  it('lists every keyword run with its change', () => {
    expect(sheetRows(selectedRunSheets(), 'Keyword runs')).toStrictEqual([
      {
        Keyword: 'hotel sol spa',
        Run: RUN_1,
        'Hotel mentioned': 'Yes',
        'Mention change': '',
        'Share of voice (%)': 50,
        'Share of voice change (pts)': '',
        'Rank #1 share (%)': 100,
        'Top-3 share (%)': 100,
        'Mean rank': 1,
        'Mean rank change': '',
        'Best rank': 1,
        Answers: 2,
        'Answers mentioning': 1,
        'Hotel score': 60,
      },
      {
        Keyword: 'hotel sol spa',
        Run: RUN_2,
        'Hotel mentioned': 'No',
        'Mention change': 'No longer mentioned',
        'Share of voice (%)': 0,
        'Share of voice change (pts)': -50,
        'Rank #1 share (%)': 100,
        'Top-3 share (%)': 100,
        'Mean rank': 1,
        'Mean rank change': '',
        'Best rank': 1,
        Answers: 2,
        'Answers mentioning': 1,
        'Hotel score': 60,
      },
    ]);
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

describe('groupKpiReportSheets with unknown values', () => {
  it('leaves unknown history values empty', () => {
    const row = sheetRows(unknownValueSheets(), 'KPI history')[0];

    expect([row['Mean rank'], row['Citation rate change (pts)'], row['Share of voice change (pts)'], row['Rank #1 share change (pts)'], row['Mean rank change']])
      .toStrictEqual(['', '', '', '', '']);
  });

  it('leaves unknown driver changes empty', () => {
    const row = sheetRows(unknownValueSheets(), 'Drivers')[0];

    expect([row['Hotel mention'], row['Share of voice change (pts)'], row['Rank #1 share change (pts)'], row['Top-3 share change (pts)'], row['Mean rank change']])
      .toStrictEqual(['', '', '', '', '']);
  });

  it('leaves unknown keyword ranks empty and names a gained mention', () => {
    const row = sheetRows(unknownValueSheets(), 'Keyword runs')[0];

    expect([row['Mean rank'], row['Best rank'], row['Mention change']]).toStrictEqual(['', '', 'Now mentioned']);
  });

  it('leaves unknown summary changes empty even for a compared run', () => {
    const summary = sheetRows(unknownValueSheets(), 'Summary');

    expect(summary.filter((row) => String(row.Metric).includes('change')).map((row) => row.Value)).toStrictEqual(['', '', '', '', '']);
  });

  it('dates each driver with its comparison run', () => {
    expect(sheetRows(unknownValueSheets(), 'Drivers')[0]['Compared with run']).toBe(RUN_1);
  });
});

describe('exportGroupKpiReport', () => {
  it('names the file after the group and the date', () => {
    expect(groupKpiReportFileName('Hotel Sol', GENERATED_AT)).toBe('hotel-visibility-report-hotel-sol-2026-09-28.xlsx');
  });

  it('writes the workbook under that name', async () => {
    await exportGroupKpiReport(HISTORY, 'Hotel Sol', SELECTED, null, GENERATED_AT);

    expect(exportWorkbook).toHaveBeenCalledWith(selectedRunSheets(null), 'hotel-visibility-report-hotel-sol-2026-09-28.xlsx');
  });
});
