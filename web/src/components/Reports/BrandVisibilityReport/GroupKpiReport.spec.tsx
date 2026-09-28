import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  renderGroupKpiReport, statCard as card
} from './GroupKpiReport-fixtures';
import {
  buildChange, buildHistory, buildRun, historyWithDriverMention, RUN_1, RUN_2, RUN_3
} from './groupKpiHistory-fixtures';
import {
  CITATION_RATE_DEFINITION, PROMINENCE_DEFINITION, SHARE_OF_VOICE_DEFINITION
} from '../../../constants/kpiDefinitions';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

describe('GroupKpiReport headline', () => {
  it('shows the citation rate of the latest group run, not of a newer partial run', () => {
    renderGroupKpiReport();

    expect(within(card('Citation rate')).getByText('60.0%')).toBeInTheDocument();
  });

  it('shows the change since the previous group run', () => {
    renderGroupKpiReport();

    expect(within(card('Citation rate')).getByText(`-20.0 pts since ${new Date(RUN_1).toLocaleString()}`)).toBeInTheDocument();
  });

  it('shows share of voice and prominence', () => {
    renderGroupKpiReport();

    expect(within(card('Share of voice')).getByText('25.0%')).toBeInTheDocument();
    expect(within(card('Prominence (rank #1)')).getByText('Top 3: 70.0% · Mean rank: 1.80')).toBeInTheDocument();
  });

  it.each([
    ['Citation rate', CITATION_RATE_DEFINITION.definition],
    ['Share of voice', SHARE_OF_VOICE_DEFINITION.definition],
    ['Prominence (rank #1)', PROMINENCE_DEFINITION.definition],
  ])('explains how %s is measured in a tooltip', (label, definition) => {
    renderGroupKpiReport();

    expect(screen.getByRole('button', { name: `About ${label}` })).toHaveAccessibleDescription(definition);
  });

  it('switches every figure to the run the reader picks', async () => {
    renderGroupKpiReport();

    await userEvent.selectOptions(screen.getByLabelText('Run'), RUN_1);

    expect(within(card('Citation rate')).getByText('80.0%')).toBeInTheDocument();
    expect(within(card('Citation rate')).getByText('No earlier group run to compare with')).toBeInTheDocument();
  });

  it('lists the runs newest first and marks partial runs', () => {
    renderGroupKpiReport();

    const options = within(screen.getByLabelText('Run')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toStrictEqual([
      `${new Date(RUN_3).toLocaleString()} · 1/5 keywords (partial)`,
      `${new Date(RUN_2).toLocaleString()} · 5/5 keywords`,
      `${new Date(RUN_1).toLocaleString()} · 5/5 keywords`,
    ]);
  });

  it('falls back to the latest run when the window holds only partial runs', () => {
    renderGroupKpiReport({
      history: buildHistory({
        runs: [buildRun({
          timestamp: RUN_3,
          is_group_run: false 
        })] 
      }) 
    });

    expect(screen.getByLabelText('Run')).toHaveValue(RUN_3);
  });
});

describe('GroupKpiReport drivers', () => {
  it('names the keyword that moved the hotel and how', () => {
    renderGroupKpiReport();

    const row = screen.getByRole('row', { name: /hotel sol spa/ });
    expect(within(row).getByText('No longer mentioned')).toBeInTheDocument();
    expect(within(row).getByText('-20.0 pts')).toBeInTheDocument();
  });

  it('summarises the group deltas', () => {
    renderGroupKpiReport();

    expect(screen.getByText(/Citation rate -20\.0 pts · Share of voice -10\.0 pts/)).toBeInTheDocument();
  });

  it('explains that a partial run is not compared', async () => {
    renderGroupKpiReport();

    await userEvent.selectOptions(screen.getByLabelText('Run'), RUN_3);

    expect(screen.getByText(/This is a partial run/)).toBeInTheDocument();
  });

  it('explains that the first group run has nothing to compare with', async () => {
    renderGroupKpiReport();

    await userEvent.selectOptions(screen.getByLabelText('Run'), RUN_1);

    expect(screen.getByText(/This is the first group run in the selected period/)).toBeInTheDocument();
  });

  it('says when no keyword changed', () => {
    renderGroupKpiReport({ history: buildHistory({ runs: [buildRun({ change: buildChange({ drivers: [] }) })] }) });

    expect(screen.getByText('No keyword changed between these runs.')).toBeInTheDocument();
  });

  it('lists keywords that joined or left the comparison', () => {
    renderGroupKpiReport({
      history: buildHistory({
        runs: [buildRun({
          change: buildChange({
            keywords_entered: ['new kw'],
            keywords_left: ['old kw'] 
          }) 
        })],
      }),
    });

    expect(screen.getByText('New in this run: new kw')).toBeInTheDocument();
    expect(screen.getByText('Missing from this run: old kw')).toBeInTheDocument();
  });

  it.each([
    ['gained', 'Now mentioned'],
    [null, 'Unchanged'],
  ] as const)('labels a keyword whose hotel mention is %s as "%s"', (mention, label) => {
    renderGroupKpiReport({ history: historyWithDriverMention(mention) });

    expect(screen.getByText(label)).toBeInTheDocument();
  });
});
