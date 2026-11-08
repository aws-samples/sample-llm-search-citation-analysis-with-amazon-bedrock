import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { OutrankedKeywordsSection } from './OutrankedKeywordsSection';
import {
  render, screen
} from '@testing-library/react';
import type { CompetitorReportResponse } from '../../../../api/reports';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../../../test/scopedTestKit';
import { HeadlineSection } from './HeadlineSection';

vi.mock('../../../../infrastructure', () => import('../../../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../../../test/infrastructureMock';

const REQUEST = {
  path: '/reports/competitor',
  params: new URLSearchParams({
    group_id: 'hotel-sol',
    competitor: 'Meliá Galicia',
    limit: '1',
  }),
};
const FIRST = {
  keyword: 'hotel con spa en galicia',
  their_best_rank: 1,
  our_best_rank: 4,
  rank_delta: 3,
  providers: ['gemini'],
};
const NEXT = {
  ...FIRST,
  keyword: 'hotel en lugo',
};
const response: CompetitorReportResponse = {
  keywords_analyzed: 160,
  coverage: {
    keywords_total: 160,
    keywords_analyzed: 160,
    complete: true,
  },
  rollup: {
    competitor: 'Meliá Galicia',
    outranked_keywords: [FIRST],
    outranked_keywords_next_token: 'tok-2',
    outranked_keywords_total: 37,
    exclusive_source_count: 0,
    high_priority_source_count: 0,
    outreach_targets: [],
  },
};
const lastPage = {
  ...response,
  rollup: {
    ...response.rollup,
    outranked_keywords: [NEXT],
    outranked_keywords_next_token: null,
  },
};
const slice = {
  rollup: response.rollup,
  response,
  request: REQUEST,
  loading: false,
  error: null,
};

/** Renders the outranked list over the first page, answers the next fetch with `page` and presses load more. */
async function renderOutrankedAfterLoadMore(page: unknown) {
  answerFetchesInOrder([page, 200]);
  render(<OutrankedKeywordsSection {...slice} />);
  await clickLoadMore('keywords');
}

describe('Competitor Gap sections on a paged scope', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it.each([
    ['counts every outranked keyword of the scope in the headline', '37'],
    ['says the headline covers every keyword of the scope', 'Covers all 160 keywords'],
  ])('%s', (_name, text) => {
    render(<HeadlineSection competitor="Meliá Galicia" keywordsAnalyzed={160} {...slice} />);

    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('appends the next page of outranked keywords', async () => {
    await renderOutrankedAfterLoadMore(lastPage);

    expect(await screen.findByText('hotel en lugo')).toBeInTheDocument();
  });

  it('asks for the next page with the cursor and the scope', async () => {
    await renderOutrankedAfterLoadMore(response);

    const { searchParams } = new URL(String(mockAuthenticatedFetch.mock.calls[0][0]));
    expect([searchParams.get('group_id'), searchParams.get('next_token')]).toStrictEqual(['hotel-sol', 'tok-2']);
  });
});
