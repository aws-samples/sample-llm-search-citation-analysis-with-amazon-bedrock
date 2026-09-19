import { vi } from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { buildAgentJob } from '../components/KeywordResearch/agent/agent-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type { KeywordResearchItem } from '../types';
import { useResearchAgent } from './useResearchAgent';

export interface AgentApiScript {
  history?: KeywordResearchItem[];
  /** Successive GET /{id} answers per id; the last one repeats. */
  snapshots?: Record<string, KeywordResearchItem[]>;
  /** Makes POST /agent fail with this structured 4xx body. */
  startError?: { error: string };
}

export interface AgentHookResult { current: ReturnType<typeof useResearchAgent> }

function scriptAgentApi(script: AgentApiScript): void {
  const served: Record<string, number> = {};
  mockAuthenticatedFetch.mockImplementation((url, init) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.includes('/keyword-research/history')) {
      return Promise.resolve(createMockJsonResponse({ items: script.history ?? [] }));
    }
    if (method === 'POST' && url.endsWith('/keyword-research/agent')) {
      if (script.startError) return Promise.resolve(createMockJsonResponse(script.startError, 400));
      return Promise.resolve(createMockJsonResponse(buildAgentJob({
        id: 'job-new',
        status: 'pending',
      }), 202));
    }
    if (method === 'POST' && url.endsWith('/retry')) {
      return Promise.resolve(createMockJsonResponse({
        id: 'job-a',
        status: 'pending',
      }, 202));
    }
    if (method === 'DELETE') {
      return Promise.resolve(createMockJsonResponse({ message: 'deleted' }));
    }
    const id = url.slice(url.lastIndexOf('/') + 1);
    const list = script.snapshots?.[id] ?? [];
    if (list.length === 0) return Promise.resolve(createMockJsonResponse({ error: 'Research not found' }, 404));
    const index = Math.min(served[id] ?? 0, list.length - 1);
    served[id] = index + 1;
    return Promise.resolve(createMockJsonResponse(list[index]));
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
