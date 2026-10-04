import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import {
  groupRunFootnote, renderGroupKpiReport, renderGroupKpiReportAt
} from './GroupKpiReport-fixtures';
import {
  headlineCardLabels, sectionTable, sectionTitled, statFigure
} from '../layout/reportQueries-fixtures';
import {
  buildChange, buildHistory, buildRun, historyWithDriverMention, historyWithoutOwnedDomains, RUN_1, RUN_2, RUN_3
} from './groupKpiHistory-fixtures';
import {
  itAsksForOwnedDomains, itShowsHeadlineCards, itShowsNoComparison
} from '../layout/kpiHeadline-fixtures';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

describe('GroupKpiReport headline cards of the latest group run, not of a newer partial run', () => {
  it('shows four cards: mention rate, share of voice, visibility score and citation rate', () => {
    renderGroupKpiReport();

    expect(headlineCardLabels()).toStrictEqual(['Mention rate', 'Share of voice', 'Visibility score', 'Citation rate']);
  });

  itShowsHeadlineCards(renderGroupKpiReport, groupRunFootnote);

  it('names the run, its answers, engines and keyword coverage', () => {
    renderGroupKpiReport();

    expect(screen.getByText(`Run of ${new Date(RUN_2).toLocaleString()} — 20 AI answers from 4 engines across 5 of 5 keywords.`))
      .toBeInTheDocument();
  });
});

describe('GroupKpiReport headline of the first group run, without a comparison', () => {
  it('switches every card to the run the reader picks', async () => {
    await renderGroupKpiReportAt(RUN_1);

    expect(statFigure('Mention rate').textContent).toBe('70.0%');
  });

  itShowsNoComparison(() => renderGroupKpiReportAt(RUN_1), 'No earlier group run to compare with');
});

describe('GroupKpiReport headline without owned domains', () => {
  itAsksForOwnedDomains(() => renderGroupKpiReport({ history: historyWithoutOwnedDomains() }), groupRunFootnote);

  it('shows the unmeasured citation rate as a dash', () => {
    renderGroupKpiReport({ history: historyWithoutOwnedDomains() });

    expect(statFigure('Citation rate').textContent).toBe('—');
  });
});

describe('GroupKpiReport run picker', () => {
  it('lists the runs newest first and marks partial runs', () => {
    renderGroupKpiReport();

    const options = within(screen.getByLabelText('Run')).getAllByRole('option').map((option) => option.textContent);
    expect(options).toStrictEqual([
      `${new Date(RUN_3).toLocaleString()} · 1/5 keywords (partial)`,
      `${new Date(RUN_2).toLocaleString()} · 5/5 keywords`,
      `${new Date(RUN_1).toLocaleString()} · 5/5 keywords`,
    ]);
  });

  it('opens on the latest group run, not the newer partial run', () => {
    renderGroupKpiReport();

    expect(screen.getByLabelText('Run')).toHaveValue(RUN_2);
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
  it('names the keyword that moved the group, how its mention changed, its changes and impacts', () => {
    renderGroupKpiReport();

    expect(sectionTable('What changed')[1]).toStrictEqual([
      'hotel sol spa', 'No longer mentioned', '-50.0 pts', '-10.0 pts', '-45.0 pts', '-9.0 pts', '-25.0 pts', '—', '-50.0 pts', '0',
    ]);
  });

  it('summarises the group changes', () => {
    renderGroupKpiReport();

    expect(within(sectionTitled('What changed')).getByText(/^Mention rate -/)).toHaveTextContent(
      'Mention rate -10.0 pts · Share of voice +5.0 pts · Visibility score -8.2 pts · Average position +0.50 · '
      + 'Top-1 share +3.0 pts · Citation rate +1.2 pts',
    );
  });

  it('dates the comparison and explains the impact', () => {
    renderGroupKpiReport();

    expect(within(sectionTitled('What changed')).getByText(/^Since the group run of/)).toHaveTextContent(
      `Since the group run of ${new Date(RUN_1).toLocaleString()}. `
      + 'Share of the group\'s change: the keyword\'s change weighted by its share of the run\'s answers.',
    );
  });

  it('explains that a partial run is not compared', async () => {
    await renderGroupKpiReportAt(RUN_3);

    expect(screen.getByText(/This is a partial run/)).toBeInTheDocument();
  });

  it('explains that the first group run has nothing to compare with', async () => {
    await renderGroupKpiReportAt(RUN_1);

    expect(screen.getByText(/This is the first group run in the selected period/)).toBeInTheDocument();
  });

  it('says when no keyword changed', () => {
    renderGroupKpiReport({ history: buildHistory({ runs: [buildRun({ change: buildChange({ drivers: [] }) })] }) });

    expect(screen.getByText('No keyword changed between these runs.')).toBeInTheDocument();
  });

  it.each([
    ['gained', 'Now mentioned'],
    ['lost', 'No longer mentioned'],
    [null, 'Unchanged'],
  ] as const)('labels a keyword whose brand mention is %s as "%s"', (mention, label) => {
    renderGroupKpiReport({ history: historyWithDriverMention(mention) });

    expect(sectionTable('What changed')[1][1]).toBe(label);
  });
});

describe('GroupKpiReport joined and missing keywords', () => {
  it('lists keywords that joined or left the comparison, separated by commas', () => {
    renderGroupKpiReport({
      history: buildHistory({
        runs: [buildRun({
          change: buildChange({
            keywords_entered: ['a', 'b'],
            keywords_left: ['c', 'd']
          })
        })],
      }),
    });

    expect(screen.getByText('New in this run: a, b')).toBeInTheDocument();
    expect(screen.getByText('Missing from this run: c, d')).toBeInTheDocument();
  });

  it('adds no joined or missing lines when the same keywords were compared', () => {
    renderGroupKpiReport();

    expect(screen.queryByText(/New in this run|Missing from this run/)).not.toBeInTheDocument();
  });
});
