/**
 * Render-and-drive harness for `useKeywordResearch` specs: the hook runs
 * against `createResearchMockFetch` and the live events mock
 * (`test/liveEventsMock`); each read of the job follows the research
 * channel's catch-up read or a reconnect (the spec owns `vi.useFakeTimers()`).
 */
import { vi } from 'vitest';
import {
  act, renderHook 
} from '@testing-library/react';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  holdLiveConnections, reconnectLive
} from '../test/liveEventsMock';
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

/** Fake time each read is given to settle: long enough for the API client's one retry of a 503 (300–811 ms). */
const READ_SETTLE_MS = 1_000;

/** Reports the research subscriptions active again `times` times, each followed by its read. */
export async function reconnectResearch(times: number): Promise<void> {
  if (times <= 0) return;
  await reconnectLive('research');
  await act(async () => {
    await vi.advanceTimersByTimeAsync(READ_SETTLE_MS);
  });
  await reconnectResearch(times - 1);
}

/**
 * Starts `operation` on the hook without awaiting it and lets it read the job `reads` times: the catch-up read
 * when the research channel connects, then one per reconnect; `0` holds the connection, so nothing is read.
 */
export async function startAndAdvance(
  result: ResearchHookResult,
  operation: (hook: ResearchHookResult['current']) => Promise<unknown>,
  reads = 1
): Promise<void> {
  if (reads === 0) holdLiveConnections();
  await act(async () => {
    void operation(result.current);
    await vi.advanceTimersByTimeAsync(READ_SETTLE_MS);
  });
  await reconnectResearch(reads - 1);
}

/** Starts an expansion of `seedKeyword` and lets it read the job `reads` times. */
export async function startExpansion(
  result: ResearchHookResult,
  reads = 1,
  seedKeyword = 'best hotels'
): Promise<void> {
  await startAndAdvance(result, (hook) => hook.expandKeywords(seedKeyword, 'hospitality', 10), reads);
}

/** Starts a competitor analysis of `url` and lets it read the job once. */
export async function startCompetitorAnalysis(result: ResearchHookResult, url: string): Promise<void> {
  await startAndAdvance(result, (hook) => hook.analyzeCompetitor(url));
}

/** Retries a partial 'best hotels' expansion job-1 and lets it read the job `reads` times. */
export async function retryPartialExpansion(
  result: ResearchHookResult,
  reads = 1
): Promise<void> {
  const partial = buildCompletedExpansionJob('job-1', 'best hotels');
  partial.status = 'partial';
  await startAndAdvance(result, (hook) => hook.retryResearch(partial), reads);
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
