import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import {
  AGENT_POLL_INTERVAL_MS, useResearchAgent
} from './useResearchAgent';
import { buildAgentJob } from '../components/KeywordResearch/agent/agent-fixtures';
import type { KeywordResearchItem } from '../types';

vi.mock('../infrastructure', async () => {
  const actual: Record<string, unknown> = await vi.importActual('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

import { authenticatedFetch } from '../infrastructure';

const mockAuthenticatedFetch = vi.mocked(authenticatedFetch);

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  } satisfies Partial<Response> as Response;
}

interface AgentApiScript {
  history?: KeywordResearchItem[];
  /** Successive GET /{id} answers per id; the last one repeats. */
  snapshots?: Record<string, KeywordResearchItem[]>;
  started?: KeywordResearchItem;
}

function scriptAgentApi(script: AgentApiScript): void {
  const served: Record<string, number> = {};
  mockAuthenticatedFetch.mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';
    if (method === 'GET' && url.includes('/keyword-research/history')) {
      return Promise.resolve(jsonResponse(200, { items: script.history ?? [] }));
    }
    if (method === 'POST' && url.endsWith('/keyword-research/agent')) {
      return Promise.resolve(jsonResponse(202, script.started ?? buildAgentJob({
        id: 'job-new',
        status: 'pending',
      })));
    }
    if (method === 'POST' && url.endsWith('/retry')) {
      return Promise.resolve(jsonResponse(202, {
        id: 'job-a',
        status: 'pending',
      }));
    }
    if (method === 'DELETE') {
      return Promise.resolve(jsonResponse(200, { message: 'deleted' }));
    }
    const id = url.slice(url.lastIndexOf('/') + 1);
    const list = script.snapshots?.[id] ?? [];
    if (list.length === 0) return Promise.resolve(jsonResponse(404, { error: 'Research not found' }));
    const index = Math.min(served[id] ?? 0, list.length - 1);
    served[id] = index + 1;
    return Promise.resolve(jsonResponse(200, list[index]));
  });
}

function requests(): string[] {
  return mockAuthenticatedFetch.mock.calls.map((call) => {
    const [url, init] = call as [string, RequestInit | undefined];
    return `${init?.method ?? 'GET'} ${url.replace('https://api.test.com', '')}`;
  });
}

/** Let pending API promises settle under fake timers. */
async function flush(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}

const START_REQUEST = {
  seed: 'Hotel Gran Marino',
  country: 'es',
  language: 'es',
  dimensions: ['destination'] as const,
  instruction: '',
  targetCount: 60,
  maxRounds: 2,
  templateId: 'builtin-default',
  systemPrompt: null,
  groupId: null,
};

describe('useResearchAgent', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('lists the agent runs from history on mount', async () => {
    scriptAgentApi({ history: [buildAgentJob()] });

    const { result } = renderHook(() => useResearchAgent());

    await flush();
    expect(result.current.jobs.map((job) => job.id)).toStrictEqual(['job-a']);
    expect(requests()[0]).toBe('GET /keyword-research/history?limit=50&type=agent');
  });

  it('starting a run prepends it to the list and opens it', async () => {
    scriptAgentApi({
      history: [buildAgentJob()],
      snapshots: {
        'job-new': [buildAgentJob({
          id: 'job-new',
          status: 'pending',
        })] 
      },
    });
    const { result } = renderHook(() => useResearchAgent());
    await flush();

    await act(async () => {
      await result.current.start({
        ...START_REQUEST,
        dimensions: [...START_REQUEST.dimensions],
      });
    });

    expect(result.current.jobs.map((job) => job.id)).toStrictEqual(['job-new', 'job-a']);
    expect(result.current.selectedId).toBe('job-new');
  });

  it('re-reads active runs on the poll interval until they finish', async () => {
    const running = buildAgentJob({
      id: 'job-r',
      status: 'running',
      keyword_count: 5,
    });
    scriptAgentApi({
      history: [running],
      snapshots: {
        'job-r': [
          buildAgentJob({
            id: 'job-r',
            status: 'running',
            keyword_count: 20,
          }),
          buildAgentJob({
            id: 'job-r',
            status: 'completed',
          }),
        ] 
      },
    });
    const { result } = renderHook(() => useResearchAgent());
    await flush();
    expect(result.current.jobs).toHaveLength(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS);
    });
    expect(result.current.jobs[0].keyword_count).toBe(20);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS);
    });
    expect(result.current.jobs[0].status).toBe('completed');

    const polls = requests().filter((request) => request === 'GET /keyword-research/job-r').length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(AGENT_POLL_INTERVAL_MS * 2);
    });
    expect(requests().filter((request) => request === 'GET /keyword-research/job-r')).toHaveLength(polls);
  });

  it('opening a run loads its full detail including the prompt', async () => {
    const listed = buildAgentJob({ system_prompt: undefined });
    scriptAgentApi({
      history: [listed],
      snapshots: { 'job-a': [buildAgentJob({ system_prompt: 'the snapshot' })] },
    });
    const { result } = renderHook(() => useResearchAgent());
    await flush();
    expect(result.current.jobs).toHaveLength(1);

    act(() => {
      result.current.select('job-a');
    });

    await flush();
    expect(result.current.selected?.system_prompt).toBe('the snapshot');
  });

  it('retrying a run marks it pending and re-reads it', async () => {
    const partial = buildAgentJob({ status: 'partial' });
    scriptAgentApi({
      history: [partial],
      snapshots: { 'job-a': [buildAgentJob({ status: 'running' })] },
    });
    const { result } = renderHook(() => useResearchAgent());
    await flush();
    expect(result.current.jobs).toHaveLength(1);

    await act(async () => {
      await result.current.retry(partial);
    });

    expect(requests()).toContain('POST /keyword-research/job-a/retry');
    expect(result.current.jobs[0].status).toBe('running');
    expect(result.current.selectedId).toBe('job-a');
  });

  it('deleting the opened run closes it', async () => {
    scriptAgentApi({
      history: [buildAgentJob()],
      snapshots: { 'job-a': [buildAgentJob()] },
    });
    const { result } = renderHook(() => useResearchAgent());
    await flush();
    expect(result.current.jobs).toHaveLength(1);
    act(() => {
      result.current.select('job-a');
    });

    await act(async () => {
      await result.current.remove('job-a');
    });

    expect(result.current.jobs).toStrictEqual([]);
    expect(result.current.selectedId).toBeNull();
  });

  it('surfaces a start failure as an error and keeps the list', async () => {
    scriptAgentApi({ history: [buildAgentJob()] });
    mockAuthenticatedFetch.mockImplementationOnce(() => Promise.resolve(jsonResponse(200, { items: [buildAgentJob()] })));
    const { result } = renderHook(() => useResearchAgent());
    await flush();
    expect(result.current.jobs).toHaveLength(1);
    mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(jsonResponse(400, { error: 'Keyword group not found' })));

    await act(async () => {
      await result.current.start({
        ...START_REQUEST,
        dimensions: [...START_REQUEST.dimensions],
        groupId: 'nope',
      });
    });

    expect(result.current.error).toBe('Keyword group not found');
    expect(result.current.jobs).toHaveLength(1);
  });
});
