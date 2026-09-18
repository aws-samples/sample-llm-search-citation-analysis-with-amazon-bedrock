import { vi } from 'vitest';
import type {
  KeywordExpansionResult, CompetitorAnalysisResult, KeywordResearchItem 
} from '../types';

export const mockExpansionResult: KeywordExpansionResult = {
  id: 'expansion-1',
  seed_keyword: 'best hotels',
  industry: 'hospitality',
  keyword_count: 2,
  keywords: [
    {
      keyword: 'best luxury hotels',
      intent: 'commercial',
      competition: 'high',
      relevance: 0.9,
      opportunity: 'high'
    },
    {
      keyword: 'top rated hotels',
      intent: 'informational',
      competition: 'medium',
      relevance: 0.85,
      opportunity: 'medium'
    },
  ],
};

export const mockCompetitorResult: CompetitorAnalysisResult = {
  id: 'competitor-1',
  url: 'https://competitor.com',
  domain: 'competitor.com',
  industry: 'hospitality',
  keyword_count: 2,
  primary_keywords: [
    {
      keyword: 'hotel deals',
      intent: 'commercial',
      competition: 'high',
      relevance: 0.8,
      source: 'title'
    },
  ],
  secondary_keywords: [
    {
      keyword: 'vacation packages',
      intent: 'commercial',
      competition: 'medium',
      relevance: 0.6,
      source: 'content'
    },
  ],
  longtail_keywords: [],
  content_gaps: [],
};

export const mockHistoryItems: KeywordResearchItem[] = [
  {
    id: 'research-1',
    type: 'expansion',
    seed_keyword: 'hotels',
    industry: 'hospitality',
    keyword_count: 5,
    created_at: '2024-01-01'
  },
  {
    id: 'research-2',
    type: 'competitor',
    url: 'https://example.com',
    domain: 'example.com',
    industry: 'hospitality',
    keyword_count: 3,
    created_at: '2024-01-02'
  },
];

export function createMockFetch(options: {
  expansionResponse?: KeywordExpansionResult;
  competitorResponse?: CompetitorAnalysisResult;
  historyResponse?: { items: KeywordResearchItem[] };
  shouldFail?: boolean;
  errorResponse?: { error: string };
} = {}) {
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if (options.shouldFail) {
      return Promise.resolve({
        ok: false,
        status: 500,
        json: () => Promise.resolve({}) 
      });
    }

    if (url.includes('/expand') && init?.method === 'POST') {
      if (options.errorResponse) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve(options.errorResponse) 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.expansionResponse ?? mockExpansionResult),
      });
    }

    if (url.includes('/competitor') && init?.method === 'POST') {
      if (options.errorResponse) {
        return Promise.resolve({
          ok: false,
          status: 400,
          json: () => Promise.resolve(options.errorResponse) 
        });
      }
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.competitorResponse ?? mockCompetitorResult),
      });
    }

    if (url.includes('/history')) {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve(options.historyResponse ?? { items: mockHistoryItems }),
      });
    }

    if (init?.method === 'DELETE') {
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ success: true }) 
      });
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve({}) 
    });
  });
}

/** A completed expansion history item for poll-path tests. */
export function buildCompletedExpansionItem(id: string, seedKeyword: string): KeywordResearchItem {
  return {
    id,
    type: 'expansion',
    seed_keyword: seedKeyword,
    industry: 'hospitality',
    keyword_count: 1,
    created_at: '2026-08-19',
    status: 'completed',
    keywords: [
      {
        keyword: `${seedKeyword} deluxe`,
        intent: 'commercial',
        competition: 'low',
        relevance: 0.9,
        opportunity: 'high',
      },
    ],
  };
}

interface PollingResearchResult {
  ok: boolean;
  status?: number;
  item?: KeywordResearchItem | null;
}

/** The id the poll requested, parsed out of `/keyword-research/{id}`. */
export function parsePolledResearchId(url: string): string | null {
  const match = /\/keyword-research\/([^/?]+)$/.exec(url);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Mock fetch for the async/polling path (AUDIT 2.20 regression tests):
 * POSTs to /expand and /competitor return a pending job id (consumed from
 * `pendingIds` in order), and each `GET /keyword-research/{id}` poll is
 * answered by calling `researchResult` with the requested id — letting tests
 * script 401s, not-ready polls, failures, or completions.
 */
export function createPollingMockFetch(options: {
  pendingIds: string[];
  researchResult: (researchId: string) => PollingResearchResult;
}) {
  const remainingIds = [...options.pendingIds];
  return vi.fn().mockImplementation((url: string, init?: RequestInit) => {
    if ((url.includes('/expand') || url.includes('/competitor')) && init?.method === 'POST') {
      const id = remainingIds.shift() ?? 'research-pending';
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          status: 'pending',
          id,
        }),
      });
    }

    // Checked before the by-id branch: the history URL also ends in a
    // single non-slash segment once the query string is attached.
    if (url.includes('/history')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [] }),
      });
    }

    const polledId = init?.method ? null : parsePolledResearchId(url);
    if (polledId) {
      const result = options.researchResult(polledId);
      return Promise.resolve({
        ok: result.ok,
        status: result.status ?? (result.ok ? 200 : 500),
        json: () => Promise.resolve(result.item ?? {}),
      });
    }

    return Promise.resolve({
      ok: true,
      status: 200,
      json: () => Promise.resolve({}),
    });
  });
}
