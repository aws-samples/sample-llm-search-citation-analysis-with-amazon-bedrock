import { act } from '@testing-library/react';
import type { VisibilityResponse } from '../types';
import {
  KEYWORD_SCOPE_INFO, buildKeywordRow, buildVisibility
} from '../components/Visibility/visibilityOverview-fixtures';
import { renderDeferredEndpoint } from './useAnalysisEndpoint-fixtures';

/** What a visibility or trends hook holds after a body that fails its type guard. */
export const INVALID_REQUEST_STATE = {
  data: null,
  error: 'Invalid visibility request',
};

/** A hook's stored data and error. */
interface HookOutcome {
  readonly data: unknown;
  readonly error: string | null;
}

/**
 * Renders `useHook`, starts one fetch through `fetch`, answers it with
 * `body` and returns the hook's data and error afterwards.
 */
export async function renderAnsweredWith<THook extends HookOutcome>(
  useHook: () => THook,
  fetch: (hook: THook) => Promise<unknown>,
  body: unknown,
): Promise<HookOutcome> {
  const {
    deferred, result, startRequest
  } = renderDeferredEndpoint(useHook);
  startRequest(fetch);
  await act(async () => {
    deferred.requests[0].respond(body);
  });
  return {
    data: result.current.data,
    error: result.current.error,
  };
}

/** `/visibility` of the "Hotel Sol" group: pooled KPIs, the leaderboard and both keyword rows. */
export const mockVisibilityResponse: VisibilityResponse = buildVisibility();

/** `/visibility` of the single keyword "hotel sol spa": the same shape, one keyword row. */
export const mockKeywordVisibilityResponse: VisibilityResponse = buildVisibility({
  scope: KEYWORD_SCOPE_INFO,
  keywords_analyzed: 1,
  keywords: [buildKeywordRow()],
});


/** Bodies the `/visibility` guard must reject: the pre-KPI shapes and a new shape missing `kpis`. */
export const REJECTED_VISIBILITY_BODIES: ReadonlyArray<[description: string, body: Record<string, unknown>]> = [
  ['the old single-keyword shape', {
    keyword: 'hotel sol spa',
    brands: [],
    summary: { first_party_avg_score: 0 },
  }],
  ['the old group shape without pooled KPIs', {
    scope: mockVisibilityResponse.scope,
    brands: [],
    keywords: [],
    summary: { coverage_rate: 0 },
  }],
  ['a body whose keyword rows are not a list', {
    ...mockVisibilityResponse,
    keywords: null,
  }],
];
