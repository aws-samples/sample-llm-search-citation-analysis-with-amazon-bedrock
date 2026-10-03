import { vi } from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { buildAgentJob } from '../components/KeywordResearch/agent/agent-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { TestAbortError } from '../test/abortError';
import type { KeywordResearchItem } from '../types';
import { createJobSnapshotReplay } from './useKeywordResearch-fixtures';
import { useResearchAgent } from './useResearchAgent';

export interface AgentApiScript {
  history?: KeywordResearchItem[];
  /** Successive GET /{id} answers per id; the last one repeats. */
  snapshots?: Record<string, KeywordResearchItem[]>;
  /** Makes POST /agent fail with this structured 4xx body. */
  startError?: { error: string };
  /** Operations whose request answers HTTP 500. */
  serverErrors?: readonly AgentOperation[];
  /** Makes GET /history reject the way an aborted request does. */
  abortHistory?: boolean;
}

export type AgentOperation = 'history' | 'start' | 'retry' | 'delete';

/** The operation a scripted request performs. */
function agentOperation(url: string, method: string): AgentOperation | 'read' {
  if (method === 'GET' && url.includes('/keyword-research/history')) return 'history';
  if (method === 'POST' && url.endsWith('/keyword-research/agent')) return 'start';
  if (method === 'POST' && url.endsWith('/retry')) return 'retry';
  if (method === 'DELETE') return 'delete';
  return 'read';
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
  const answers: Record<AgentOperation | 'read', (url: string) => Response> = {
    history: () => historyResponse(script),
    start: () => startRunResponse(script),
    retry: retryRunResponse,
    delete: () => createMockJsonResponse({ message: 'deleted' }),
    read: (url) => nextSnapshot(url.slice(url.lastIndexOf('/') + 1)),
  };
  mockAuthenticatedFetch.mockImplementation((url, init) => {
    const operation = agentOperation(url, init?.method ?? 'GET');
    if (operation === 'history' && script.abortHistory) return Promise.reject(new TestAbortError());
    if (operation !== 'read' && script.serverErrors?.includes(operation)) {
      return Promise.resolve(createMockJsonResponse({ error: 'internal' }, 500));
    }
    return Promise.resolve(answers[operation](url));
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

/** Script the agent API, render the hook and unmount it before the history load settles. */
export async function renderAgentRunsUnmountedEarly(script: AgentApiScript): Promise<void> {
  scriptAgentApi(script);
  const { unmount } = renderHook(() => useResearchAgent());
  unmount();
  await advanceBy(0);
}

/** Open a run and let its detail load. */
export async function openRun(result: AgentHookResult, id: string): Promise<void> {
  act(() => {
    result.current.select(id);
  });
  await advanceBy(0);
}
