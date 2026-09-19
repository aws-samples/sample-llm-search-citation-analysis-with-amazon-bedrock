import {
  describe, it, expect, vi 
} from 'vitest';
import {
  deleteKeywordResearch,
  fetchKeywordResearch,
  fetchKeywordResearchHistory,
  InvalidKeywordResearchResponseError,
  isKeywordResearchItem,
  retryKeywordResearch,
  startCompetitorAnalysis,
  startKeywordExpansion,
} from './keywordResearch';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';


function respondWith(status: number, body: unknown): void {
  mockAuthenticatedFetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    json: () => Promise.resolve(body),
  } satisfies Partial<Response> as Response);
}

function lastRequest(): {
  url: string;
  init: RequestInit | undefined 
} {
  const calls = mockAuthenticatedFetch.mock.calls;
  const [url, init] = calls[calls.length - 1] as [string, RequestInit | undefined];
  return {
    url,
    init 
  };
}

const PENDING_JOB = {
  id: 'job-1',
  type: 'expansion',
  status: 'pending',
  industry: 'hotels',
  keyword_count: 0,
  created_at: '2026-09-18T10:00:00Z',
};

describe('isKeywordResearchItem', () => {
  it('accepts an object with a string id and a known type', () => {
    expect(isKeywordResearchItem(PENDING_JOB)).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(isKeywordResearchItem({
      ...PENDING_JOB,
      type: 'agent' 
    })).toBe(false);
  });

  it('rejects a missing id', () => {
    expect(isKeywordResearchItem({ type: 'expansion' })).toBe(false);
  });
});

describe('keyword research client', () => {
  it('starts an expansion with the seed, industry and count', async () => {
    respondWith(202, PENDING_JOB);

    const job = await startKeywordExpansion('hotel malaga', 'hotels', 30);

    const {
      url, init 
    } = lastRequest();
    expect(url).toBe('https://api.test.com/keyword-research/expand');
    expect(JSON.parse(String(init?.body))).toStrictEqual({
      seed_keyword: 'hotel malaga',
      industry: 'hotels',
      count: 30 
    });
    expect(job.id).toBe('job-1');
  });

  it('starts a competitor analysis with the url', async () => {
    respondWith(202, {
      ...PENDING_JOB,
      type: 'competitor' 
    });

    const job = await startCompetitorAnalysis('https://example.com');

    expect(lastRequest().url).toBe('https://api.test.com/keyword-research/competitor');
    expect(job.type).toBe('competitor');
  });

  it('throws InvalidKeywordResearchResponseError when the start response is not a job', async () => {
    respondWith(202, { message: 'started' });

    await expect(startKeywordExpansion('x', 'general', 20)).rejects.toThrow(InvalidKeywordResearchResponseError);
    await expect(startKeywordExpansion('x', 'general', 20)).rejects.toThrow('Keyword research API returned an invalid job');
  });

  it('surfaces the structured 4xx message when a start is rejected', async () => {
    respondWith(400, { error: 'No API keys configured.' });

    await expect(startKeywordExpansion('x', 'general', 20)).rejects.toThrow('No API keys configured.');
  });

  it('posts to the retry route of the job', async () => {
    respondWith(202, {
      id: 'job 1',
      status: 'pending' 
    });

    await retryKeywordResearch('job 1');

    const {
      url, init 
    } = lastRequest();
    expect(url).toBe('https://api.test.com/keyword-research/job%201/retry');
    expect(init?.method).toBe('POST');
  });

  it('reads a job by id', async () => {
    respondWith(200, {
      ...PENDING_JOB,
      status: 'running' 
    });

    const job = await fetchKeywordResearch('job-1');

    expect(lastRequest().url).toBe('https://api.test.com/keyword-research/job-1');
    expect(job.status).toBe('running');
  });

  it('reads history with the type filter and the page size', async () => {
    respondWith(200, { items: [PENDING_JOB, { junk: true }] });

    const items = await fetchKeywordResearchHistory('expansion');

    expect(lastRequest().url).toBe('https://api.test.com/keyword-research/history?limit=50&type=expansion');
    expect(items.map((item) => item.id)).toStrictEqual(['job-1']);
  });

  it('throws InvalidKeywordResearchResponseError when history has no items list', async () => {
    respondWith(200, { count: 0 });

    await expect(fetchKeywordResearchHistory()).rejects.toThrow(InvalidKeywordResearchResponseError);
  });

  it('deletes a job by id', async () => {
    respondWith(200, { message: 'deleted' });

    await deleteKeywordResearch('job-1');

    const {
      url, init 
    } = lastRequest();
    expect(url).toBe('https://api.test.com/keyword-research/job-1');
    expect(init?.method).toBe('DELETE');
  });
});
