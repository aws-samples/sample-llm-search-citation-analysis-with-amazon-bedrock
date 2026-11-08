import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  render, screen
} from '@testing-library/react';
import {
  buildPromptEngine, buildPromptEngineRow
} from '../../../types/domain/insightFacts-fixtures';
import {
  answerFetchesInOrder, clickLoadMore
} from '../../../test/scopedTestKit';
import { insightsWithFacts } from './insightSections-fixtures';
import { PromptEngineSection } from './PromptEngineSection';

vi.mock('../../../infrastructure', () => import('../../../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../../../test/infrastructureMock';

const INSIGHTS_REQUEST = {
  path: '/reports/insights',
  params: new URLSearchParams({
    group_id: 'lima-routes',
    days: '30',
  }),
};
const pagedSlice = {
  ...insightsWithFacts({
    prompt_engine: buildPromptEngine({
      omitted: 1,
      keywords_next_token: 'prompts-2',
    }),
  }),
  request: INSIGHTS_REQUEST,
};
const promptEngineLastPage = {
  facts: {
    prompt_engine: {
      keywords: [buildPromptEngineRow({ keyword: 'vuelos baratos a Cusco' })],
      next_token: null,
    },
  },
};

/** Renders the prompts-by-engine table over its first page, answers the next fetch with the last page and presses load more. */
async function renderPromptsAfterLoadMore() {
  answerFetchesInOrder([promptEngineLastPage, 200]);
  render(<PromptEngineSection {...pagedSlice} />);
  await clickLoadMore('keywords');
}

describe('PromptEngineSection past its first page', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('appends the next page of keywords', async () => {
    await renderPromptsAfterLoadMore();

    expect(await screen.findByText('vuelos baratos a Cusco')).toBeInTheDocument();
  });

  it('asks for the next page over view=prompt_engine with the cursor and the scope', async () => {
    await renderPromptsAfterLoadMore();

    const { searchParams } = new URL(String(mockAuthenticatedFetch.mock.calls[0][0]));
    expect([searchParams.get('view'), searchParams.get('next_token'), searchParams.get('group_id')])
      .toStrictEqual(['prompt_engine', 'prompts-2', 'lima-routes']);
  });

  it('drops the left-out note once every keyword is loaded', async () => {
    await renderPromptsAfterLoadMore();
    await screen.findByText('vuelos baratos a Cusco');

    expect(screen.queryByText(/not shown/u)).not.toBeInTheDocument();
  });

  it('offers Export all of the scope insights', () => {
    render(<PromptEngineSection {...pagedSlice} />);

    expect(screen.getByRole('button', { name: 'Export all' })).toBeInTheDocument();
  });
});
