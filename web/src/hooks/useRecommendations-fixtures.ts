import { useEffect } from 'react';
import {
  describe, expect, it
} from 'vitest';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import type {
  Recommendation, RecommendationsResponse, ReportScope
} from '../types';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../components/ui/reportScope-fixtures';
import {
  createEndpointMockFetch, createMockJsonResponse
} from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { useRecommendations } from './useRecommendations';

export const mockRecommendationsResponse: RecommendationsResponse = {
  recommendations: [
    {
      type: 'content_gap',
      priority: 'high',
      title: 'Create content for high-traffic keyword',
      description: 'Competitors are ranking for "best hotels" but you are not mentioned.',
      action: 'Create targeted content',
      impact: 'High visibility increase',
      keywords: ['best hotels'],
      id: 'rec-001',
      status: 'new',
    },
    {
      type: 'brand_mention',
      priority: 'medium',
      title: 'Increase brand visibility',
      description: 'Your brand is mentioned less frequently than competitors.',
      action: 'Improve brand presence',
      impact: 'Medium brand awareness boost',
      id: 'rec-002',
      status: 'in_progress',
      notes: 'Owner: brand team',
    },
  ],
  total_count: 2,
  generated_at: '2024-01-01T00:00:00Z',
  by_priority: {
    high: 1,
    medium: 1,
    low: 0,
  },
};

/** The first fixture recommendation, narrowed to the tracked (id-carrying) shape `updateStatus` takes. */
export function trackedRecommendation(index: number): Recommendation & { id: string } {
  const recommendation = mockRecommendationsResponse.recommendations[index];
  return {
    ...recommendation,
    id: recommendation.id ?? `missing-id-${index}`,
  };
}

/** Renders `useRecommendations` with `mockRecommendationsResponse` already fetched. */
export async function renderFetchedRecommendations() {
  mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(mockRecommendationsResponse));
  const rendered = renderHook(() => useRecommendations());
  await act(async () => {
    await rendered.result.current.fetchRecommendations();
  });
  return rendered;
}

/** The status each fixture recommendation shows, in list order. */
export function statusesOf(response: RecommendationsResponse | null): Array<string | undefined> {
  return (response?.recommendations ?? []).map((rec) => rec.status);
}

/**
 * Renders `useScopedHook(scope)` with the effect its view runs — `fetchOf(hook)`
 * whenever that fetch is rebuilt — over an endpoint answering `response`,
 * starting at `initialScope`; `rerender({ scope })` switches the scope.
 */
function renderFetchedPerScope<THook>(
  useScopedHook: (scope: ReportScope) => THook,
  fetchOf: (hook: THook) => () => Promise<unknown>,
  response: unknown,
  initialScope: ReportScope = ALL_SCOPE,
) {
  mockAuthenticatedFetch.mockImplementation(createEndpointMockFetch(response));
  return renderHook(({ scope }: { scope: ReportScope }) => {
    const hook = useScopedHook(scope);
    const fetch = fetchOf(hook);
    useEffect(() => {
      void fetch();
    }, [fetch]);
    return hook;
  }, { initialProps: { scope: initialScope } });
}

export interface ScopedRequestsContract<THook> {
  /** The hook under test; its fetch is rebuilt whenever the scope changes. */
  readonly useScopedHook: (scope: ReportScope) => THook;
  /** The hook's fetch function, run with no arguments. */
  readonly fetchOf: (hook: THook) => () => Promise<unknown>;
  /** What the mocked endpoint answers. */
  readonly response: unknown;
  /** The URL requested when the scope contributes `scopeQuery` (`group_id=grp-luxury`). */
  readonly urlFor: (scopeQuery: string) => string;
  /** `authenticatedFetch` arguments for `url`; defaults to the URL alone. */
  readonly expectedRequest?: (url: string) => readonly unknown[];
}

/**
 * The scope behaviour every scoped analysis hook shares, as one parametrised
 * suite: a group or keyword scope reaches the request as `group_id` or
 * `keyword`, and switching scope makes an effect listing the fetch request
 * the new scope.
 */
export function describeScopedRequests<THook>({
  useScopedHook, fetchOf, response, urlFor, expectedRequest = (url) => [url]
}: ScopedRequestsContract<THook>): void {
  const renderFetching = (scope?: ReportScope) => renderFetchedPerScope(useScopedHook, fetchOf, response, scope);

  describe('report scope', () => {
    it.each([
      ['group_id=grp-luxury', 'a keyword group', groupScope('grp-luxury')],
      ['keyword=best+hotels', 'one keyword', keywordScope('best hotels')],
    ])('requests %s when rendered for %s', async (scopeQuery, _scope, scope) => {
      renderFetching(scope);

      await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledWith(...expectedRequest(urlFor(scopeQuery))));
    });

    it('requests the newly selected group when the scope changes', async () => {
      const { rerender } = renderFetching();
      await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1));

      rerender({ scope: groupScope('grp-luxury') });

      await waitFor(() => expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2));
      expect(mockAuthenticatedFetch).toHaveBeenLastCalledWith(...expectedRequest(urlFor('group_id=grp-luxury')));
    });
  });
}
