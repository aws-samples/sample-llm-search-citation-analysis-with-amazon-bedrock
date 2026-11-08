import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import {
  buildKeywordTrend, buildTrendView
} from '../../layout/reportPayload-fixtures';
import {
  buildScopeReport, reportWithTrends, reportWithVisibility, settledSlice
} from '../../scopeReport/scopeReport-fixtures';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../../../test/scopedTestKit';
import { buildReportSources } from '../customReportPages-fixtures';
import { ReportBlockView } from '../ReportBlockView';

vi.mock('../../../../infrastructure', () => import('../../../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../../../test/infrastructureMock';

const TRENDS_REQUEST = {
  path: '/trends',
  params: new URLSearchParams({
    scope: 'all',
    period: 'day',
    days: '30',
  }),
};

/** The per-keyword leaderboard block over a first page of one keyword with a cursor to the next. */
function renderKeywordTableBlock() {
  const scope = buildScopeReport({
    trends: settledSlice(buildTrendView({
      keyword_trends: [buildKeywordTrend('zapatillas trail')],
      keyword_trends_next_token: 'trends-2',
      keyword_trends_total: 2,
    })),
    trendsRequest: TRENDS_REQUEST,
  });
  render(<ReportBlockView block={{ type: 'visibility_keyword_table' }} sources={buildReportSources({ scope })} />);
}

describe('visibility_keyword_table block', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('loads the keywords past the first page', async () => {
    answerFetchesInOrder([{
      keyword_trends: [buildKeywordTrend('botas de montaña')],
      keyword_trends_total: 2,
      next_token: null,
    }, 200]);
    renderKeywordTableBlock();

    await clickLoadMore('keywords');

    expect(await screen.findByText('botas de montaña')).toBeInTheDocument();
  });
});

describe('scope block coverage', () => {
  it('says the block covers fewer keywords when the trends read was cut short', () => {
    const scope = reportWithTrends({
      coverage: {
        keywords_total: 928,
        keywords_analyzed: 400,
        complete: false,
      },
    });
    render(<ReportBlockView block={{ type: 'visibility_trend_history' }} sources={buildReportSources({ scope })} />);

    expect(screen.getByRole('note')).toHaveTextContent('Covers 400 of 928 keywords');
  });

  it('says the block covers every keyword when the visibility read is complete', () => {
    const scope = reportWithVisibility({
      coverage: {
        keywords_total: 928,
        keywords_analyzed: 928,
        complete: true,
      },
    });
    render(<ReportBlockView block={{ type: 'visibility_headline' }} sources={buildReportSources({ scope })} />);

    expect(screen.getByText('Covers all 928 keywords')).toBeInTheDocument();
  });
});
