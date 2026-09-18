import { vi } from 'vitest';
import type {
  KeywordResearchItem, ResearchStep
} from '../types';

export const mockHistoryItems: KeywordResearchItem[] = [
  {
    id: 'research-1',
    type: 'expansion',
    seed_keyword: 'hotels',
    industry: 'hospitality',
    keyword_count: 5,
    created_at: '2024-01-01',
    status: 'completed',
  },
  {
    id: 'research-2',
    type: 'competitor',
    url: 'https://example.com',
    domain: 'example.com',
    industry: 'hospitality',
    keyword_count: 3,
    created_at: '2024-01-02',
    status: 'partial',
  },
];

export function buildStep(provider: string, overrides: Partial<ResearchStep> = {}): ResearchStep {
  return {
    step_id: `r1-${provider}`,
    provider,
    status: 'completed',
    keyword_count: 1,
    ...overrides,
  };
}

/** A research job snapshot as `GET /keyword-research/{id}` returns it. */
export function buildJob(overrides: Partial<KeywordResearchItem> = {}): KeywordResearchItem {
  return {
    id: 'job-1',
    type: 'expansion',
    seed_keyword: 'best hotels',
    industry: 'hospitality',
    status: 'pending',
    keyword_count: 0,
    created_at: '2026-09-18T10:00:00Z',
    steps: [],
    steps_total: 0,
    steps_done: 0,
    ...overrides,
  };
}

export function buildCompletedExpansionJob(id: string, seedKeyword: string): KeywordResearchItem {
  return buildJob({
    id,
    seed_keyword: seedKeyword,
    status: 'completed',
    keyword_count: 1,
    steps_total: 1,
    steps_done: 1,
    steps: [buildStep('openai')],
    keywords: [
      {
        keyword: `${seedKeyword} deluxe`,
        intent: 'commercial',
        competition: 'low',
        relevance: 0.9,
        opportunity: 'high',
        providers: ['openai'],
      },
    ],
  });
}

export function buildCompletedCompetitorJob(id: string, url: string): KeywordResearchItem {
  return buildJob({
    id,
    type: 'competitor',
    seed_keyword: undefined,
    url,
    domain: 'competitor.com',
    provider: 'openai',
    status: 'completed',
    keyword_count: 2,
    steps_total: 1,
    steps_done: 1,
    steps: [buildStep('openai', { keyword_count: 2 })],
    analysis: {
      industry: 'hospitality',
      primary_keywords: [{
        keyword: 'hotel deals',
        intent: 'commercial',
        competition: 'high',
        relevance: 0.8 
      }],
      secondary_keywords: [{
        keyword: 'vacation packages',
        intent: 'commercial',
        competition: 'medium',
        relevance: 0.6 
      }],
      longtail_keywords: [],
      content_gaps: [],
    },
  });
}

interface MockJsonResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  json: () => Promise<unknown>;
}

function jsonResponse(status: number, body: unknown): MockJsonResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  };
}

export interface ResearchMockFetchOptions {
  /** Job ids handed out by successive POST /expand and /competitor calls. */
  pendingIds?: string[];
  /**
   * Snapshots returned by successive GET /keyword-research/{id} calls, per id.
   * The last snapshot repeats once the list is exhausted.
   */
  snapshots?: Record<string, KeywordResearchItem[]>;
  /** Replaces the snapshot lookup: script raw poll responses (401s, 404s). */
  pollResponse?: () => MockJsonResponse;
  /** Makes POST /expand and /competitor fail with this structured 4xx body. */
  startError?: { error: string };
  historyItems?: KeywordResearchItem[];
}

/**
 * Mock `authenticatedFetch` for the research API: starts return a pending job
 * with the next id from `pendingIds`, polls replay `snapshots[id]` in order,
 * `/retry` answers 202, `/history` and DELETE answer from fixtures.
 */
export function createResearchMockFetch(options: ResearchMockFetchOptions = {}) {
  const remainingIds = [...(options.pendingIds ?? ['job-1'])];
  const served: Record<string, number> = {};

  const nextSnapshot = (id: string): MockJsonResponse => {
    const list = options.snapshots?.[id] ?? [];
    if (list.length === 0) return jsonResponse(404, { error: 'Research not found' });
    const index = Math.min(served[id] ?? 0, list.length - 1);
    served[id] = index + 1;
    return jsonResponse(200, list[index]);
  };

  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    const method = init?.method ?? 'GET';

    if (method === 'POST' && (url.endsWith('/expand') || url.endsWith('/competitor'))) {
      if (options.startError) return Promise.resolve(jsonResponse(400, options.startError));
      const id = remainingIds.shift() ?? 'job-pending';
      const type = url.endsWith('/expand') ? 'expansion' : 'competitor';
      return Promise.resolve(jsonResponse(202, buildJob({
        id,
        type 
      })));
    }

    if (method === 'POST' && url.endsWith('/retry')) {
      return Promise.resolve(jsonResponse(202, {
        id: 'job-1',
        status: 'pending' 
      }));
    }

    if (method === 'GET' && url.includes('/keyword-research/history')) {
      return Promise.resolve(jsonResponse(200, { items: options.historyItems ?? mockHistoryItems }));
    }

    if (method === 'GET') {
      if (options.pollResponse) return Promise.resolve(options.pollResponse());
      const id = url.slice(url.lastIndexOf('/') + 1);
      return Promise.resolve(nextSnapshot(id));
    }

    return Promise.resolve(jsonResponse(200, { success: true }));
  });
}
