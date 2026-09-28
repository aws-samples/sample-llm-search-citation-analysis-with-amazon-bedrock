import {
  describe, expect, it, vi
} from 'vitest';
import {
  screen, within
} from '@testing-library/react';
import {
  renderGroupKpiReport, sectionTable, sectionTitled, statFigure
} from './GroupKpiReport-fixtures';
import {
  buildChange, buildHistory, buildKeywordHistory, buildKeywordRun, buildRun, RUN_1, RUN_2
} from './groupKpiHistory-fixtures';

vi.mock('chart.js', () => import('../../Dashboard/chartJs-fixtures'));

describe('GroupKpiReport tables', () => {
  it('lays out the driver table with every column', () => {
    renderGroupKpiReport();

    expect(sectionTable('What changed')).toStrictEqual([
      ['Keyword', 'Hotel mention', 'Citation rate impact', 'Share of voice', 'SOV impact', 'Rank #1 share', 'Top-3 share', 'Mean rank'],
      ['hotel sol spa', 'No longer mentioned', '-20.0 pts', '-50.0 pts', '-10.0 pts', '-100.0 pts', '-100.0 pts', '—'],
    ]);
  });

  it('lays out the keyword detail table newest first with every column', () => {
    renderGroupKpiReport();

    expect(sectionTable('Keyword detail')).toStrictEqual([
      ['Run', 'Hotel mentioned', 'Share of voice', 'Rank #1 share', 'Top-3 share', 'Mean rank', 'Best rank', 'Answers mentioning'],
      [new Date(RUN_2).toLocaleString(), 'No (lost)', '0.0% (-50.0 pts)', '100.0% (-100.0 pts)', '100.0% (-100.0 pts)', '1.00', '#1', '1 of 2'],
      [new Date(RUN_1).toLocaleString(), 'Yes', '50.0%', '100.0%', '100.0%', '1.00', '#1', '1 of 2'],
    ]);
  });

  it('names each keyword with its number of runs in the picker', () => {
    renderGroupKpiReport();

    expect(within(screen.getByLabelText('Keyword')).getAllByRole('option').map((option) => option.textContent)).toStrictEqual([
      'hotel sol beach (0 runs)', 'hotel sol spa (2 runs)',
    ]);
  });

  it('shows a keyword value without a change when that value could not be compared', () => {
    renderGroupKpiReport({
      history: buildHistory({
        keywords: [buildKeywordHistory('k', [buildKeywordRun({
          change: {
            previous_timestamp: RUN_1,
            mention: null,
            first_party_sov: 5,
            rank_1_share: null,
            top_3_share: null,
            mean_rank: null,
          },
        })])],
      }),
    });

    expect(sectionTable('Keyword detail')[1].slice(2, 5)).toStrictEqual(['50.0% (+5.0 pts)', '100.0%', '100.0%']);
  });

  it('shows a mean rank change and a rank the hotel never reached', () => {
    renderGroupKpiReport({
      history: buildHistory({
        runs: [buildRun({
          change: buildChange({
            deltas: {
              coverage_rate: 0,
              first_party_avg_sov: 0,
              rank_1_share: 0,
              top_3_share: 0,
              mean_rank: 0.5 
            } 
          }) 
        })],
        keywords: [buildKeywordHistory('k', [buildKeywordRun({
          mean_rank: null,
          first_party_best_rank: null 
        })])],
      }),
    });

    expect(sectionTable('Keyword detail')[1].slice(5, 7)).toStrictEqual(['—', '—']);
    expect(screen.getByText(/Mean rank \+0\.50/)).toBeInTheDocument();
  });
});

describe('GroupKpiReport what-changed text', () => {
  it('summarises every group delta', () => {
    renderGroupKpiReport();

    expect(within(sectionTitled('What changed')).getByText(/^Citation rate -/).textContent).toBe(
      'Citation rate -20.0 pts · Share of voice -10.0 pts · Rank #1 share +5.0 pts · Top-3 share 0.0 pts · Mean rank +0.50',
    );
  });

  it('dates the comparison and explains impact', () => {
    renderGroupKpiReport();

    expect(within(sectionTitled('What changed')).getByText(/^Since the group run of/).textContent).toBe(
      `Since the group run of ${new Date(RUN_1).toLocaleString()}. Impact = the keyword's change divided by the keywords with results.`,
    );
  });

  it('lists several joined and missing keywords separated by commas', () => {
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

describe('GroupKpiReport headline details', () => {
  it('names the run and its coverage', () => {
    renderGroupKpiReport();

    expect(screen.getByText(`Run of ${new Date(RUN_2).toLocaleString()} — 5 of 5 keywords with results.`)).toBeInTheDocument();
  });

  it.each([
    ['Citation rate', 'text-red-700'],
    ['Share of voice', 'text-red-700'],
    ['Prominence (rank #1)', 'text-emerald-700'],
  ])('colours %s by the direction of its change', (label, colour) => {
    renderGroupKpiReport();

    expect(statFigure(label)).toHaveClass(colour);
  });

  it('keeps the heading while the history loads', () => {
    renderGroupKpiReport({
      history: null,
      loading: true 
    });

    expect(screen.getByRole('heading', { name: 'Headline' })).toBeInTheDocument();
  });
});

describe('GroupKpiReport model list', () => {
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
});
