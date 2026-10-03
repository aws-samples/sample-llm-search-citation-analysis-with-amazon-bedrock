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
  buildCompletedExpansionJob, createResearchMockFetch, type ResearchMockFetchOptions 
} from './useKeywordResearch-fixtures';

interface ResearchHookResult { current: ReturnType<typeof useKeywordResearch> }

/** Points the mocked network layer at `createResearchMockFetch(options)` and renders the hook. */
export function renderResearch(options: ResearchMockFetchOptions = {}) {
  mockAuthenticatedFetch.mockImplementation(createResearchMockFetch(options));
  return renderHook(() => useKeywordResearch());
}

/**
 * Starts `operation` on the hook without awaiting it and lets `elapsedMs` of
 * fake time pass (one fast poll tick by default), flushing the resulting
 * state updates.
 */
export async function startAndAdvance(
  result: ResearchHookResult,
  operation: (hook: ResearchHookResult['current']) => Promise<unknown>,
  elapsedMs = POLL_FAST_INTERVAL_MS
): Promise<void> {
  await act(async () => {
    void operation(result.current);
    await vi.advanceTimersByTimeAsync(elapsedMs);
  });
}

/** Starts an expansion of `seedKeyword` and lets `elapsedMs` of fake time pass. */
export async function startExpansion(
  result: ResearchHookResult,
  elapsedMs = POLL_FAST_INTERVAL_MS,
  seedKeyword = 'best hotels'
): Promise<void> {
  await startAndAdvance(result, (hook) => hook.expandKeywords(seedKeyword, 'hospitality', 10), elapsedMs);
}

/** Starts a competitor analysis of `url` and lets one fast poll tick pass. */
export async function startCompetitorAnalysis(result: ResearchHookResult, url: string): Promise<void> {
  await startAndAdvance(result, (hook) => hook.analyzeCompetitor(url));
}

/** Retries a partial 'best hotels' expansion job-1 and lets `elapsedMs` of fake time pass. */
export async function retryPartialExpansion(
  result: ResearchHookResult,
  elapsedMs = POLL_FAST_INTERVAL_MS
): Promise<void> {
  const partial = buildCompletedExpansionJob('job-1', 'best hotels');
  partial.status = 'partial';
  await startAndAdvance(result, (hook) => hook.retryResearch(partial), elapsedMs);
}

export interface RecordedCall {
  url: string;
  method: string;
  body: string | undefined;
}

function recordedCalls(): RecordedCall[] {
  return mockAuthenticatedFetch.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit | undefined];
    return {
      url,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? init.body : undefined,
    };
  });
}

export function findCall(predicate: (call: RecordedCall) => boolean): RecordedCall | undefined {
  return recordedCalls().find(predicate);
}

export function countJobPolls(): number {
  return recordedCalls().filter((call) => call.method === 'GET' && /\/keyword-research\/[^/?]+$/.test(call.url)).length;
}
