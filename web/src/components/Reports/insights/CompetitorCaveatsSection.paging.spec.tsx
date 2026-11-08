import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import { buildCaveatRow } from '../../../types/domain/insightFacts-fixtures';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../../test/scopedTestKit';
import {
  insightsWithFacts, sectionRows
} from './insightSections-fixtures';
import {
  COMPETITOR_CAVEATS_TITLE, CompetitorCaveatsSection
} from './CompetitorCaveatsSection';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';

const INSIGHTS_REQUEST = {
  path: '/reports/insights',
  params: new URLSearchParams({
    group_id: 'lima-routes',
    days: '30',
  }),
};
const FIRST_THREE = ['Extra fees for carry-on bags', 'Frequent delays', 'Small seats'];
const pagedSlice = {
  ...insightsWithFacts({
    competitor_caveats: [buildCaveatRow({
      reasons: FIRST_THREE,
      reasons_total: 4,
    })],
    caveat_reasons: {
      reasons: [],
      reasons_total: 4,
      reasons_next_token: 'reasons-0',
    },
  }),
  request: INSIGHTS_REQUEST,
};
const reasonsPage = {
  facts: {
    caveat_reasons: {
      reasons: [...FIRST_THREE, 'Lost luggage'].map((reason) => ({
        competitor: 'Borealis Air',
        reason,
      })),
      reasons_total: 4,
      next_token: null,
    },
  },
};

/** Renders the caveats over an answer that lists no reason page, answers the reasons page and presses load more. */
async function renderCaveatsAfterLoadMore() {
  answerFetchesInOrder([reasonsPage, 200]);
  render(<CompetitorCaveatsSection {...pagedSlice} />);
  await clickLoadMore('reasons');
}

describe('CompetitorCaveatsSection past the first three reasons', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('says how many reasons the rows leave out', () => {
    render(<CompetitorCaveatsSection {...pagedSlice} />);

    expect(screen.getByText('1 more reason is not shown.')).toBeInTheDocument();
  });

  it('adds each competitor\'s further reasons to its row once loaded', async () => {
    await renderCaveatsAfterLoadMore();

    await screen.findByText('Lost luggage');

    expect(sectionRows(COMPETITOR_CAVEATS_TITLE)[0][5]).toBe(`${FIRST_THREE.join('')}Lost luggage`);
  });

  it('asks for the reasons over view=caveat_reasons with the cursor and the scope', async () => {
    await renderCaveatsAfterLoadMore();

    const { searchParams } = new URL(String(mockAuthenticatedFetch.mock.calls[0][0]));
    expect([searchParams.get('view'), searchParams.get('next_token'), searchParams.get('group_id')])
      .toStrictEqual(['caveat_reasons', 'reasons-0', 'lima-routes']);
  });

  it('drops the load button once every reason is shown', async () => {
    await renderCaveatsAfterLoadMore();

    await screen.findByText('Lost luggage');

    expect(screen.queryByRole('button', { name: 'Load more reasons' })).not.toBeInTheDocument();
  });

  it('offers no load button when every row shows all its reasons', () => {
    render(<CompetitorCaveatsSection {...insightsWithFacts({})} request={INSIGHTS_REQUEST} />);

    expect(screen.queryByRole('button', { name: 'Load more reasons' })).not.toBeInTheDocument();
  });
});
