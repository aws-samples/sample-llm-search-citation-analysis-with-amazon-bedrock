import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import {
  buildBrandRow, buildVisibility
} from '../layout/reportPayload-fixtures';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../../test/scopedTestKit';
import { buildScopeReport } from './scopeReport-fixtures';
import { BRAND_COLUMN } from './brandColumns';
import { ScopeBrandTable } from './ScopeLists';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';

const BENCHMARK_REQUEST = {
  path: '/visibility',
  params: new URLSearchParams({ group_id: 'running' }),
};
const firstBrandPage = buildVisibility({
  brands: [buildBrandRow('Nike')],
  brands_total: 2,
  brands_next_token: 'brands-2',
});
const pagedReport = buildScopeReport({ visibilityRequest: BENCHMARK_REQUEST });

/** Renders the brand table over the first page, answers the next fetch with Hoka's page and presses load more. */
async function renderBrandsAfterLoadMore() {
  answerFetchesInOrder([{
    brands: [buildBrandRow('Hoka')],
    brands_total: 2,
    next_token: null,
  }, 200]);
  render(<ScopeBrandTable report={pagedReport} visibility={firstBrandPage} columns={[BRAND_COLUMN]} />);
  await clickLoadMore('brands');
}

describe('ScopeBrandTable', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('appends the next page of brands', async () => {
    await renderBrandsAfterLoadMore();

    expect(await screen.findByText('Hoka')).toBeInTheDocument();
  });

  it('asks for the next page over view=brands with the cursor and the scope', async () => {
    await renderBrandsAfterLoadMore();

    const { searchParams } = new URL(String(mockAuthenticatedFetch.mock.calls[0][0]));
    expect([searchParams.get('view'), searchParams.get('next_token'), searchParams.get('group_id')])
      .toStrictEqual(['brands', 'brands-2', 'running']);
  });

  it('offers Export all of the leaderboard once the request is known', () => {
    render(<ScopeBrandTable report={pagedReport} visibility={firstBrandPage} columns={[BRAND_COLUMN]} />);

    expect(screen.getByRole('button', { name: 'Export all' })).toBeInTheDocument();
  });

  it('offers no Export all before the request is known', () => {
    render(<ScopeBrandTable report={buildScopeReport()} visibility={firstBrandPage} columns={[BRAND_COLUMN]} />);

    expect(screen.queryByRole('button', { name: 'Export all' })).not.toBeInTheDocument();
  });
});
