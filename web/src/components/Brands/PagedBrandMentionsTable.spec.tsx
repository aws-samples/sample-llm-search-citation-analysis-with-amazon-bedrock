import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  buildAggregatedBrand, mockBrandMentionsResponse
} from '../../hooks/useBrandMentions-fixtures';
import { answerFetchesInOrder } from '../../test/scopedTestKit';
import type { BrandMentionsResponse } from '../../types';

vi.mock('../../infrastructure', () => import('../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../test/infrastructureMock';
import { PagedBrandMentionsTable } from './PagedBrandMentionsTable';

const REQUEST = {
  path: '/brand-mentions',
  params: new URLSearchParams({ group_id: 'group-coruna' }),
};
const FIRST_PAGE: BrandMentionsResponse = {
  ...mockBrandMentionsResponse,
  aggregated: {
    ...mockBrandMentionsResponse.aggregated,
    brands_total: 3,
    brands_next_token: 'page-2',
  },
};
const SECOND_PAGE = {
  aggregated: {
    brands: [buildAggregatedBrand({
      name: 'Third Hotel',
      overall_rank: 3,
      best_rank: 3,
      classification: 'competitor' 
    })],
    brands_total: 3,
    next_token: null,
  },
};

function renderFirstPage(data: BrandMentionsResponse = FIRST_PAGE): void {
  render(<PagedBrandMentionsTable data={data} request={REQUEST} keyword="Hotel Coruña" onBrandClick={vi.fn()} config={null} />);
}

describe('PagedBrandMentionsTable', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('says how many of the scope brands the first page shows', () => {
    renderFirstPage();

    expect(screen.getByText('Showing 2 of 3 brands')).toBeInTheDocument();
  });

  it('appends the next brands when Load more brands is pressed', async () => {
    answerFetchesInOrder([SECOND_PAGE, 200]);
    renderFirstPage();

    await userEvent.click(screen.getByRole('button', { name: 'Load more brands' }));

    expect(await screen.findByText('Third Hotel')).toBeInTheDocument();
  });

  it('asks for the next page with view=brands and the cursor of the summary', async () => {
    answerFetchesInOrder([SECOND_PAGE, 200]);
    renderFirstPage();

    await userEvent.click(screen.getByRole('button', { name: 'Load more brands' }));
    await screen.findByText('Third Hotel');

    expect(String(mockAuthenticatedFetch.mock.calls[0][0])).toContain('/brand-mentions?group_id=group-coruna&view=brands&next_token=page-2');
  });

  it('offers no Load more when the summary holds every brand', () => {
    renderFirstPage(mockBrandMentionsResponse);

    expect(screen.queryByRole('button', { name: 'Load more brands' })).not.toBeInTheDocument();
  });
});
