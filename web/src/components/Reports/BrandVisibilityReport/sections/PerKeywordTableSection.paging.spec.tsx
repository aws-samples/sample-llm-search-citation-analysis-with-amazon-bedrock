import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { PerKeywordTableSection } from './PerKeywordTableSection';
import {
  render, screen
} from '@testing-library/react';
import {
  buildKeywordTrend, trendViewOf
} from '../../layout/reportPayload-fixtures';
import { settledTrends } from '../../layout/reportSlice-fixtures';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../../../test/scopedTestKit';

vi.mock('../../../../infrastructure', () => import('../../../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../../../test/infrastructureMock';

const pagedTrends = {
  ...trendViewOf([buildKeywordTrend('shoes')]),
  keyword_trends_next_token: 'tok-2',
  keyword_trends_total: 2,
};
const REQUEST = {
  path: '/trends',
  params: new URLSearchParams({
    scope: 'all',
    days: '30',
  }),
};
const lastTrendsPage = {
  keyword_trends: [buildKeywordTrend('boots')],
  keyword_trends_total: 2,
  next_token: null,
};

describe('PerKeywordTableSection on a paged scope', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('says how many of the scope\'s keywords are listed', () => {
    render(<PerKeywordTableSection {...settledTrends(pagedTrends)} request={REQUEST} />);

    expect(screen.getByText('Showing 1 of 2 keywords')).toBeInTheDocument();
  });

  it('appends the next keyword trends page from view=keyword_trends', async () => {
    answerFetchesInOrder([lastTrendsPage, 200]);
    render(<PerKeywordTableSection {...settledTrends(pagedTrends)} request={REQUEST} />);

    await clickLoadMore('keywords');

    expect(await screen.findByText('boots')).toBeInTheDocument();
  });

  it('shows no load more for a scope listed whole', () => {
    render(<PerKeywordTableSection {...settledTrends(trendViewOf([buildKeywordTrend('shoes')]))} request={REQUEST} />);

    expect(screen.queryByRole('button', { name: 'Load more keywords' })).not.toBeInTheDocument();
  });
});
