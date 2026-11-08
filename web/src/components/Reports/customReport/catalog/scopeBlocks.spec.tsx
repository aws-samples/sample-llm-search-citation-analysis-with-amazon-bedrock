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
  buildScopeReport, settledSlice
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
