import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useState } from 'react';
import type { ContentIdea } from '../types';
import { useContentIdeasPaging } from './useContentIdeasPaging';
import { mockContentIdea } from './useContentStudio-fixtures';
import {
  buildContentIdeaDecoderRecord, buildIdeasDecoderPayload
} from '../api/contentStudioDecoders-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const SCOPE_PARAMS = {
  group_id: 'coruna-hotels',
  market_id: 'es-es',
};

/** The paging hook over a real ideas state, its first page `[mockContentIdea]` with a cursor to `ideas-2` among 2 ideas. */
function renderIdeasPaging() {
  const onError = vi.fn();
  const hook = renderHook(() => {
    const [ideas, setIdeas] = useState<ContentIdea[]>([mockContentIdea]);
    return {
      ideas,
      paging: useContentIdeasPaging(setIdeas, onError),
    };
  });
  act(() => {
    hook.result.current.paging.applyFirstPage(SCOPE_PARAMS, {
      nextToken: 'ideas-2',
      total: 2,
    });
  });
  return hook;
}

/** Answers the next ideas read with the last page: one idea, `idea-2`. */
function stubLastIdeasPage(): void {
  mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(buildIdeasDecoderPayload(
    buildContentIdeaDecoderRecord({ id: 'idea-2' }),
    {
      total_count: 1,
      ideas_total: 2,
      ideas_next_token: null,
    },
  )));
}

describe('useContentIdeasPaging', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('says more ideas are left while the first page has a cursor', () => {
    const { result } = renderIdeasPaging();

    expect([result.current.paging.ideasHasMore, result.current.paging.ideasTotal]).toStrictEqual([true, 2]);
  });

  it('appends the next page of ideas', async () => {
    stubLastIdeasPage();
    const { result } = renderIdeasPaging();

    await act(() => result.current.paging.loadMoreIdeas());

    expect(result.current.ideas.map((idea) => idea.id)).toStrictEqual([mockContentIdea.id, 'idea-2']);
  });

  it('asks for the next page with the cursor, the scope and the market', async () => {
    stubLastIdeasPage();
    const { result } = renderIdeasPaging();

    await act(() => result.current.paging.loadMoreIdeas());

    const { searchParams } = new URL(String(mockAuthenticatedFetch.mock.calls[0][0]));
    expect([searchParams.get('next_token'), searchParams.get('group_id'), searchParams.get('market_id')])
      .toStrictEqual(['ideas-2', 'coruna-hotels', 'es-es']);
  });

  it('stops offering more once the last page is loaded', async () => {
    stubLastIdeasPage();
    const { result } = renderIdeasPaging();

    await act(() => result.current.paging.loadMoreIdeas());

    expect(result.current.paging.ideasHasMore).toBe(false);
  });
});
