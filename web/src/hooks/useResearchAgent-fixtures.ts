import { vi } from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { buildAgentJob } from '../components/KeywordResearch/agent/agent-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type { KeywordResearchItem } from '../types';
import { createJobSnapshotReplay } from './useKeywordResearch-fixtures';
import { useResearchAgent } from './useResearchAgent';

export interface AgentApiScript {
  history?: KeywordResearchItem[];
  /** Successive GET /{id} answers per id; the last one repeats. */
  snapshots?: Record<string, KeywordResearchItem[]>;
  /** Makes POST /agent fail with this structured 4xx body. */
  startError?: { error: string };
}

export interface AgentHookResult { current: ReturnType<typeof useResearchAgent> }

/** GET /keyword-research/history: the scripted runs. */
function historyResponse(script: AgentApiScript): Response {
  return createMockJsonResponse({ items: script.history ?? [] });
}

/** POST /keyword-research/agent: the new pending run, or the scripted 4xx rejection. */
function startRunResponse(script: AgentApiScript): Response {
  if (script.startError) return createMockJsonResponse(script.startError, 400);
  return createMockJsonResponse(buildAgentJob({
    id: 'job-new',
    status: 'pending',
  }), 202);
}

/** POST /keyword-research/{id}/retry: job-a is pending again. */
function retryRunResponse(): Response {
  return createMockJsonResponse({
    id: 'job-a',
    status: 'pending',
  }, 202);
}

function scriptAgentApi(script: AgentApiScript): void {
  const nextSnapshot = createJobSnapshotReplay(script.snapshots);
  mockAuthenticatedFetch.mockImplementation((url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.includes('/keyword-research/history')) return Promise.resolve(historyResponse(script));
    if (method === 'POST' && url.endsWith('/keyword-research/agent')) return Promise.resolve(startRunResponse(script));
    if (method === 'POST' && url.endsWith('/retry')) return Promise.resolve(retryRunResponse());
    if (method === 'DELETE') return Promise.resolve(createMockJsonResponse({ message: 'deleted' }));
    return Promise.resolve(nextSnapshot(url.slice(url.lastIndexOf('/') + 1)));
  });
}

export function requests(): string[] {
  return mockAuthenticatedFetch.mock.calls.map(([url, init]) => `${init?.method ?? 'GET'} ${url.replace('https://api.test.com', '')}`);
}

/** Let the requested fake time pass; zero only settles pending API promises. */
export async function advanceBy(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Script the agent API, render the hook, and let the history load settle. */
export async function renderAgentRuns(script: AgentApiScript): Promise<AgentHookResult> {
  scriptAgentApi(script);
  const { result } = renderHook(() => useResearchAgent());
  await advanceBy(0);
  return result;
}

/** Open a run and let its detail load. */
export async function openRun(result: AgentHookResult, id: string): Promise<void> {
  act(() => {
    result.current.select(id);
  });
  await advanceBy(0);
}
