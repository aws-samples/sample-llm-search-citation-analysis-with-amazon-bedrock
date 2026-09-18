/**
 * Render-and-drive harness for `useKeywordResearch` specs: the hook runs
 * against `createResearchMockFetch` and its poll loop is advanced with fake
 * timers (the spec owns `vi.useFakeTimers()`).
 */
import { vi } from 'vitest';
import {
  act, renderHook 
} from '@testing-library/react';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { POLL_FAST_INTERVAL_MS } from './researchPolling';
import { useKeywordResearch } from './useKeywordResearch';
import {
  createResearchMockFetch, type ResearchMockFetchOptions 
} from './useKeywordResearch-fixtures';

interface ResearchHookResult { current: ReturnType<typeof useKeywordResearch> }

/** Points the mocked network layer at `createResearchMockFetch(options)` and renders the hook. */
export function renderResearch(options: ResearchMockFetchOptions = {}) {
  mockAuthenticatedFetch.mockImplementation(createResearchMockFetch(options));
  return renderHook(() => useKeywordResearch());
}

/**
 * Starts an expansion of `seedKeyword` and lets `elapsedMs` of fake time pass
 * (one fast poll tick by default), flushing the resulting state updates.
 */
export async function startExpansion(
  result: ResearchHookResult,
  elapsedMs = POLL_FAST_INTERVAL_MS,
  seedKeyword = 'best hotels'
): Promise<void> {
  await act(async () => {
    void result.current.expandKeywords(seedKeyword, 'hospitality', 10);
    await vi.advanceTimersByTimeAsync(elapsedMs);
  });
}

/** Starts a competitor analysis of `url` and lets one fast poll tick pass. */
export async function startCompetitorAnalysis(result: ResearchHookResult, url: string): Promise<void> {
  await act(async () => {
    void result.current.analyzeCompetitor(url);
    await vi.advanceTimersByTimeAsync(POLL_FAST_INTERVAL_MS);
  });
}
