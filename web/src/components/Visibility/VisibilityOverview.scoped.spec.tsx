import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { renderOverview } from './overviewRender-fixtures';
import {
  screen, waitFor, within
} from '@testing-library/react';
import {
  buildBrandRow, buildKeywordRow, buildVisibility
} from './visibilityOverview-fixtures';
import { panelTitled } from './visibilityTables-fixtures';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../test/scopedTestKit';
import { scopedFixture } from '../../test/scopedFixtures';

vi.mock('chart.js', () => import('../Dashboard/chartJs-fixtures'));
vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../test/infrastructureMock';

const REQUEST = {
  path: '/visibility',
  params: new URLSearchParams({ scope: 'all' }),
};
const FIRST_ROW = buildKeywordRow({ keyword: 'hotel a coruña' });
const NEXT_ROW = buildKeywordRow({ keyword: 'hotel lugo' });
const pagedVisibility = buildVisibility({
  keywords: [FIRST_ROW],
  keywords_next_token: 'tok-2',
  keywords_total: 2,
  coverage: {
    keywords_total: 2,
    keywords_analyzed: 2,
    complete: true,
  },
});
const lastPage = {
  keywords: [NEXT_ROW],
  keywords_total: 2,
  next_token: null,
};

describe('VisibilityOverview on a 2.45.0 scope', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('shows the coverage of the scope', () => {
    renderOverview({ visibility: buildVisibility(scopedFixture('visibility', 'partial')) });

    expect(screen.getByRole('note')).toHaveTextContent(/^Covers \d+ of \d+ keywords\. The request ran out of time/u);
  });

  it('shows the updating note for a stale snapshot', () => {
    renderOverview({ visibility: buildVisibility(scopedFixture('visibility', 'stale')) });

    expect(screen.getByText(/Updating to the latest keyword changes/u)).toBeInTheDocument();
  });

  it('says how many keyword rows of the scope are shown', () => {
    renderOverview({
      visibility: pagedVisibility,
      request: REQUEST,
    });

    expect(screen.getByText('Showing 1 of 2 keywords')).toBeInTheDocument();
  });

  it('appends the next keyword page when Load more is pressed', async () => {
    answerFetchesInOrder([lastPage, 200]);
    renderOverview({
      visibility: pagedVisibility,
      request: REQUEST,
    });

    await clickLoadMore('keywords');

    expect(await within(screen.getByRole('table', { name: 'Keywords in this scope' })).findByText('hotel lugo')).toBeInTheDocument();
  });

  it('appends the next brand leaderboard page from view=brands', async () => {
    answerFetchesInOrder([{
      brands: [buildBrandRow({
        name: 'Rival Inn',
        classification: 'competitor' 
      })],
      brands_total: 3,
      next_token: null,
    }, 200]);
    renderOverview({
      visibility: buildVisibility({
        brands_next_token: 'b-2',
        brands_total: 3,
      }),
      request: REQUEST,
    });

    await clickLoadMore('brands');

    expect(await within(panelTitled('Brand leaderboard')).findByText('Rival Inn')).toBeInTheDocument();
  });

  it('asks the next leaderboard page with view=brands and its token', async () => {
    answerFetchesInOrder([{
      brands: [buildBrandRow({
        name: 'Rival Inn',
        classification: 'competitor' 
      })],
      brands_total: 3,
      next_token: null,
    }, 200]);
    renderOverview({
      visibility: buildVisibility({
        brands_next_token: 'b-2',
        brands_total: 3,
      }),
      request: REQUEST,
    });

    await clickLoadMore('brands');

    await waitFor(() => expect(String(mockAuthenticatedFetch.mock.calls[0]?.[0])).toBe('https://api.test.com/visibility?scope=all&view=brands&next_token=b-2'));
  });

  it('says how many cited domains of the total are shown', () => {
    renderOverview({
      visibility: buildVisibility({
        sources_next_token: 's-2',
        sources_total: 140,
      }),
      request: REQUEST,
    });

    expect(screen.getByText(/^Showing \d+ of 140 cited domains$/u)).toBeInTheDocument();
  });
});
