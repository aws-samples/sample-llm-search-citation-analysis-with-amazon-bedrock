import {
  describe, it, expect, vi, beforeEach 
} from 'vitest';
import {
  createResearchTemplate,
  deleteKeywordResearch,
  deleteResearchTemplate,
  fetchKeywordResearch,
  fetchKeywordResearchHistory,
  fetchResearchTemplates,
  InvalidKeywordResearchResponseError,
  isKeywordResearchItem,
  isResearchTemplate,
  retryKeywordResearch,
  startCompetitorAnalysis,
  startKeywordExpansion,
  startResearchAgent,
  updateResearchTemplate,
} from './keywordResearch';

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

  it('accepts the research-agent type', () => {
    expect(isKeywordResearchItem({
      ...PENDING_JOB,
      type: 'agent' 
    })).toBe(true);
  });

  it('rejects an unknown type', () => {
    expect(isKeywordResearchItem({
      ...PENDING_JOB,
      type: 'crawl' 
    })).toBe(false);
  });

  it('rejects a missing id', () => {
    expect(isKeywordResearchItem({ type: 'expansion' })).toBe(false);
  });
});

describe('keyword research client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

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

const AGENT_REQUEST = {
  seed: 'Hotel Gran Marino',
  country: 'es',
  language: 'es',
  dimensions: ['destination', 'audience'] as const,
  instruction: 'also events',
  targetCount: 60,
  maxRounds: 2,
  templateId: 'builtin-default',
  systemPrompt: null,
  groupId: 'g1',
};

const TEMPLATE = {
  id: 't1',
  name: 'Beach resorts',
  description: '',
  system_prompt: 'You research beach resorts for families.',
  builtin: false,
};

describe('research agent client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts an agent run with the brief in the API field names', async () => {
    respondWith(202, {
      ...PENDING_JOB,
      type: 'agent' 
    });

    await startResearchAgent({
      ...AGENT_REQUEST,
      dimensions: [...AGENT_REQUEST.dimensions],
    });

    const {
      url, init 
    } = lastRequest();
    expect(url).toBe('https://api.test.com/keyword-research/agent');
    expect(JSON.parse(String(init?.body))).toStrictEqual({
      seed: 'Hotel Gran Marino',
      country: 'es',
      language: 'es',
      dimensions: ['destination', 'audience'],
      instruction: 'also events',
      target_count: 60,
      max_rounds: 2,
      template_id: 'builtin-default',
      group_id: 'g1',
    });
  });

  it('sends the edited prompt only when the form changed it', async () => {
    respondWith(202, {
      ...PENDING_JOB,
      type: 'agent' 
    });

    await startResearchAgent({
      ...AGENT_REQUEST,
      dimensions: [...AGENT_REQUEST.dimensions],
      systemPrompt: 'edited prompt text here',
      groupId: null,
    });

    const body: Record<string, unknown> = JSON.parse(String(lastRequest().init?.body));
    expect(body.system_prompt).toBe('edited prompt text here');
    expect(body).not.toHaveProperty('group_id');
  });

  it('lists templates and drops malformed entries', async () => {
    respondWith(200, { items: [TEMPLATE, { id: 'broken' }] });

    const templates = await fetchResearchTemplates();

    expect(templates).toStrictEqual([TEMPLATE]);
  });

  it('creates a template with the API field names', async () => {
    respondWith(201, TEMPLATE);

    const created = await createResearchTemplate({
      name: 'Beach resorts',
      systemPrompt: 'You research beach resorts for families.',
    });

    expect(created).toStrictEqual(TEMPLATE);
    expect(JSON.parse(String(lastRequest().init?.body))).toStrictEqual({
      name: 'Beach resorts',
      system_prompt: 'You research beach resorts for families.',
    });
  });

  it('updates only the fields given', async () => {
    respondWith(200, {
      ...TEMPLATE,
      name: 'Renamed' 
    });

    await updateResearchTemplate('t1', { name: 'Renamed' });

    const {
      url, init 
    } = lastRequest();
    expect(url).toBe('https://api.test.com/keyword-research/templates/t1');
    expect(init?.method).toBe('PUT');
    expect(JSON.parse(String(init?.body))).toStrictEqual({ name: 'Renamed' });
  });

  it('deletes a template by id', async () => {
    respondWith(200, { message: 'deleted' });

    await deleteResearchTemplate('t1');

    const {
      url, init 
    } = lastRequest();
    expect(url).toBe('https://api.test.com/keyword-research/templates/t1');
    expect(init?.method).toBe('DELETE');
  });

  it('recognises a template payload', () => {
    expect(isResearchTemplate(TEMPLATE)).toBe(true);
    expect(isResearchTemplate({
      id: 't1',
      name: 'x' 
    })).toBe(false);
  });
});
