import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  keywordDetailMentions, renderGroupKpiReport, sectionTable, sectionTitled
} from './GroupKpiReport-fixtures';
import {
  buildHistory, buildKeywordChange, buildKeywordRun, buildRun, historyWithKeywordRun, KEYWORD_KPIS, RUN_1, RUN_2
} from './groupKpiHistory-fixtures';
import { GROUP_REPORT_DEFINITIONS } from '../../../constants/kpiDefinitions';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

const CHARTED = 'Mention rate, Share of voice, Visibility score, Top-1 share, Citation rate';

describe('GroupKpiReport evolution', () => {
  it('draws the chart from the group runs', () => {
    renderGroupKpiReport();

    expect(screen.getByText(`${CHARTED} over 2 runs (0–100).`)).toBeInTheDocument();
  });

  it('adds partial runs to the chart when asked', async () => {
    renderGroupKpiReport();

    await userEvent.click(screen.getByLabelText('Include partial runs'));

    expect(screen.getByText(`${CHARTED} over 3 runs (0–100).`)).toBeInTheDocument();
  });

  it('lists the model changes between group runs', () => {
    renderGroupKpiReport();

    expect(screen.getByText(`${new Date(RUN_2).toLocaleDateString()} · openai: gpt-5-mini → gpt-5.2`)).toBeInTheDocument();
  });

  it('lists every model of a provider that answered with several', () => {
    renderGroupKpiReport({
      history: buildHistory({
        runs: [
          buildRun({
            timestamp: RUN_1,
            models: { openai: ['a', 'b'] }
          }),
          buildRun({
            timestamp: RUN_2,
            models: { openai: ['c', 'd'] }
          }),
        ],
      }),
    });

    expect(screen.getByText(`${new Date(RUN_2).toLocaleDateString()} · openai: a, b → c, d`)).toBeInTheDocument();
  });

  it('shows no model list when every run used the same models', () => {
    renderGroupKpiReport({ history: buildHistory({ runs: [buildRun({ timestamp: RUN_1 }), buildRun({ timestamp: RUN_2 })] }) });

    expect(screen.queryByText('Model changes')).not.toBeInTheDocument();
  });

  it('says when the period holds no group run to draw', () => {
    renderGroupKpiReport({ history: buildHistory({ runs: [buildRun({ is_group_run: false })] }) });

    expect(screen.getByText('No group run in this period yet.')).toBeInTheDocument();
  });

  it('states the coverage a group run needs', () => {
    renderGroupKpiReport({ history: buildHistory({ group_run_min_coverage: 60 }) });

    expect(screen.getByText(/less than 60% of the group's keywords/)).toBeInTheDocument();
  });
});

describe('GroupKpiReport keyword detail', () => {
  it('opens on the first keyword that has runs', () => {
    renderGroupKpiReport();

    expect(screen.getByLabelText('Keyword')).toHaveValue('hotel sol spa');
  });

  it('names each keyword with its number of runs in the picker', () => {
    renderGroupKpiReport();

    expect(within(screen.getByLabelText('Keyword')).getAllByRole('option').map((option) => option.textContent)).toStrictEqual([
      'hotel sol beach (0 runs)', 'hotel sol spa (2 runs)',
    ]);
  });

  it('lists the keyword runs newest first with whether the brand was lost', () => {
    renderGroupKpiReport();

    expect(keywordDetailMentions()).toStrictEqual(['No (lost)', 'Yes']);
  });

  it('switches to the keyword the reader picks', async () => {
    renderGroupKpiReport();

    await userEvent.selectOptions(screen.getByLabelText('Keyword'), 'hotel sol beach');

    expect(screen.getByText('No analysis run of this keyword in the selected period.')).toBeInTheDocument();
  });

  it('labels a keyword run where the brand became mentioned as "Yes (new)"', () => {
    renderGroupKpiReport({ history: historyWithKeywordRun(buildKeywordRun({ change: buildKeywordChange('gained') })) });

    expect(keywordDetailMentions()).toStrictEqual(['Yes (new)']);
  });

  it('labels a keyword run with unknown mentions as not mentioned', () => {
    renderGroupKpiReport({
      history: historyWithKeywordRun(buildKeywordRun({
        kpis: {
          ...KEYWORD_KPIS,
          mentions: null
        }
      }))
    });

    expect(keywordDetailMentions()).toStrictEqual(['No']);
  });

  it('shows a value without a change when that value could not be compared', () => {
    renderGroupKpiReport({ history: historyWithKeywordRun(buildKeywordRun({ change: buildKeywordChange(null, { mention_rate: 5 }) })) });

    expect(sectionTable('Keyword detail')[1].slice(3, 6)).toStrictEqual(['50.0% (+5.0 pts)', '25.0%', '1.50']);
  });

  it('shows an unknown answer count as a dash', () => {
    renderGroupKpiReport({
      history: historyWithKeywordRun(buildKeywordRun({
        kpis: {
          ...KEYWORD_KPIS,
          answers: null
        }
      }))
    });

    expect(sectionTable('Keyword detail')[1][2]).toBe('2 of —');
  });

  it('shows no keyword detail for a group without keywords', () => {
    renderGroupKpiReport({ history: buildHistory({ keywords: [] }) });

    expect(screen.queryByLabelText('Keyword')).not.toBeInTheDocument();
  });
});

describe('GroupKpiReport definitions', () => {
  it('names every KPI, the group run and the trend rule in the definitions block, in order', () => {
    renderGroupKpiReport();

    expect(within(sectionTitled('How these KPIs are measured')).getAllByRole('term').map((term) => term.textContent))
      .toStrictEqual(GROUP_REPORT_DEFINITIONS.map((entry) => entry.label));
  });

  it('writes out every definition for print', () => {
    renderGroupKpiReport();

    expect(within(sectionTitled('How these KPIs are measured')).getAllByRole('definition').map((entry) => entry.textContent))
      .toStrictEqual(GROUP_REPORT_DEFINITIONS.map((entry) => entry.definition));
  });

  it('keeps the definitions while the history loads', () => {
    renderGroupKpiReport({
      history: null,
      loading: true
    });

    expect(within(sectionTitled('How these KPIs are measured')).getAllByRole('term')).toHaveLength(GROUP_REPORT_DEFINITIONS.length);
  });
});

describe('GroupKpiReport period and states', () => {
  it('asks for another period when the reader picks one', async () => {
    const { onDaysChange } = renderGroupKpiReport();

    await userEvent.selectOptions(screen.getByLabelText('Period'), '365');

    expect(onDaysChange).toHaveBeenCalledWith(365);
  });

  it('offers the last 30, 90, 180 and 365 days', () => {
    renderGroupKpiReport();

    expect(within(screen.getByLabelText('Period')).getAllByRole('option').map((option) => option.textContent)).toStrictEqual([
      'Last 30 days', 'Last 90 days', 'Last 180 days', 'Last 365 days',
    ]);
  });

  it('says when the period holds no run and keeps the period picker', () => {
    renderGroupKpiReport({ history: buildHistory({ runs: [] }) });

    expect(screen.getByText('No analysis run of this group in the last 90 days. Run an analysis or choose a longer period.')).toBeInTheDocument();
    expect(screen.getByLabelText('Period')).toBeInTheDocument();
  });

  it('shows the loading state and keeps the heading', () => {
    renderGroupKpiReport({
      history: null,
      loading: true
    });

    expect(screen.getByText('Loading the group KPI history…')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Headline' })).toBeInTheDocument();
  });

  it('shows the error', () => {
    renderGroupKpiReport({
      history: null,
      error: 'Failed to fetch the group KPI history'
    });

    expect(screen.getByText('Failed to fetch the group KPI history')).toBeInTheDocument();
  });
});

describe('GroupKpiReport download and coverage notes', () => {
  it('offers the whole report as an Excel download', () => {
    renderGroupKpiReport();

    expect(screen.getByRole('button', { name: 'Export to Excel' })).toBeInTheDocument();
  });

  it('offers no download before there is a run to export', () => {
    renderGroupKpiReport({ history: buildHistory({ runs: [] }) });

    expect(screen.queryByRole('button', { name: 'Export to Excel' })).not.toBeInTheDocument();
  });

  it('warns when the group has more keywords than the report covers', () => {
    renderGroupKpiReport({ history: buildHistory({ keywords_truncated: true }) });

    expect(screen.getByRole('note')).toHaveTextContent('only the first 2 are included');
  });

  it('adds no warning when every keyword is covered', () => {
    renderGroupKpiReport();

    expect(screen.queryByRole('note')).not.toBeInTheDocument();
  });
});
