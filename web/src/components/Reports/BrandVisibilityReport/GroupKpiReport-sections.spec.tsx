import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  keywordDetailMentions, renderGroupKpiReport
} from './GroupKpiReport-fixtures';
import {
  buildHistory, buildKeywordHistory, buildKeywordRun, buildRun, RUN_1, RUN_2
} from './groupKpiHistory-fixtures';
import { VISIBILITY_KPI_DEFINITIONS } from '../../../constants/kpiDefinitions';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

describe('GroupKpiReport evolution', () => {
  it('draws the chart from the group runs', () => {
    renderGroupKpiReport();

    expect(screen.getByText('Citation rate, share of voice, rank #1 share and top-3 share over 2 runs.')).toBeInTheDocument();
  });

  it('adds partial runs to the chart when asked', async () => {
    renderGroupKpiReport();

    await userEvent.click(screen.getByLabelText('Include partial runs'));

    expect(screen.getByText('Citation rate, share of voice, rank #1 share and top-3 share over 3 runs.')).toBeInTheDocument();
  });

  it('lists the model changes between group runs', () => {
    renderGroupKpiReport();

    expect(screen.getByText(`${new Date(RUN_2).toLocaleDateString()} · openai: gpt-5-mini → gpt-5.2`)).toBeInTheDocument();
  });

  it('shows no model list when every run used the same models', () => {
    renderGroupKpiReport({ history: buildHistory({ runs: [buildRun({ timestamp: RUN_1 }), buildRun({ timestamp: RUN_2 })] }) });

    expect(screen.queryByText('Model changes')).not.toBeInTheDocument();
  });

  it('says when the period holds no group run to draw', () => {
    renderGroupKpiReport({history: buildHistory({runs: [buildRun({ is_group_run: false })]})});

    expect(screen.getByText('No group run in this period yet.')).toBeInTheDocument();
  });
});

describe('GroupKpiReport keyword detail', () => {
  it('opens on the first keyword that has runs', () => {
    renderGroupKpiReport();

    expect(screen.getByLabelText('Keyword')).toHaveValue('hotel sol spa');
  });

  it('lists the keyword runs newest first with what changed', () => {
    renderGroupKpiReport();

    expect(keywordDetailMentions()).toStrictEqual(['No (lost)', 'Yes']);
  });

  it('shows the share-of-voice change next to the value', () => {
    renderGroupKpiReport();

    expect(screen.getByText('0.0% (-50.0 pts)')).toBeInTheDocument();
  });

  it('shows how many answers mention the hotel and its best rank', () => {
    renderGroupKpiReport();

    expect(screen.getAllByText('1 of 2')).toHaveLength(2);
    expect(screen.getAllByText('#1')).toHaveLength(2);
  });

  it('switches to the keyword the reader picks', async () => {
    renderGroupKpiReport();

    await userEvent.selectOptions(screen.getByLabelText('Keyword'), 'hotel sol beach');

    expect(screen.getByText('No analysis run of this keyword in the selected period.')).toBeInTheDocument();
  });

  it('labels a keyword run where the hotel became mentioned', () => {
    renderGroupKpiReport({
      history: buildHistory({
        keywords: [buildKeywordHistory('k', [buildKeywordRun({
          change: {
            previous_timestamp: RUN_1,
            mention: 'gained',
            first_party_sov: null,
            rank_1_share: null,
            top_3_share: null,
            mean_rank: null,
          },
        })])],
      }),
    });

    expect(screen.getByText('Yes (new)')).toBeInTheDocument();
  });

  it('shows an unknown best rank as a dash', () => {
    renderGroupKpiReport({ history: buildHistory({ keywords: [buildKeywordHistory('k', [buildKeywordRun({ first_party_best_rank: null })])] }) });

    expect(within(screen.getByRole('row', { name: /^.*Yes/ })).getAllByText('—')).toHaveLength(1);
  });

  it('shows no keyword detail for a group without keywords', () => {
    renderGroupKpiReport({ history: buildHistory({ keywords: [] }) });

    expect(screen.queryByLabelText('Keyword')).not.toBeInTheDocument();
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

  it('shows the loading state', () => {
    renderGroupKpiReport({
      history: null,
      loading: true 
    });

    expect(screen.getByText('Loading the group KPI history…')).toBeInTheDocument();
  });

  it('shows the error', () => {
    renderGroupKpiReport({
      history: null,
      error: 'Failed to fetch the group KPI history' 
    });

    expect(screen.getByText('Failed to fetch the group KPI history')).toBeInTheDocument();
  });

  it('writes out every KPI definition for print', () => {
    renderGroupKpiReport();

    expect(VISIBILITY_KPI_DEFINITIONS.map((entry) => screen.getAllByText(entry.definition).length > 0)).toStrictEqual([true, true, true, true]);
  });
});


describe('GroupKpiReport coverage notes', () => {
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

  it('states the coverage a group run needs', () => {
    renderGroupKpiReport({ history: buildHistory({ group_run_min_coverage: 60 }) });

    expect(screen.getByText(/less than 60% of the group's keywords/)).toBeInTheDocument();
  });
});
