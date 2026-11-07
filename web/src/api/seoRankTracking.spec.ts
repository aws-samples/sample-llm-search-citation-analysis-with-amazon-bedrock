import { InvalidSeoResponseError } from './seoDecoders';
import {
  describe, expect, it, vi
} from 'vitest';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  createRankTracker,
  estimateRankTracker,
  fetchLatestRankRun,
  fetchRankHistory,
  fetchRankResults,
  fetchRankTrackers,
  fetchRankTrend,
  removeRankKeywords,
  startRankRun,
} from './seoRankTracking';
import {
  buildRankEstimate, buildRankResults, buildRankRun, buildRankTracker, buildRankTrend, buildTrackerList
} from './seoRankTracking-fixtures';
import {
  sentSeoRequest, withoutField
} from './seo-fixtures';

vi.mock('../infrastructure/config', () => ({
  SEO_API_BASE_URL: 'https://seo.rank.test.com/api',
  API_BASE_URL: 'https://api.rank.test.com',
}));
vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

describe('rank tracking client', () => {
  it('returns the decoded tracker list', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildTrackerList()));

    await expect(fetchRankTrackers()).resolves.toStrictEqual(buildTrackerList());
  });

  it('throws InvalidSeoResponseError when a tracker has no domain', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildTrackerList({trackers: [buildRankTracker({ domain: 7 as unknown as string })],})));

    await expect(fetchRankTrackers()).rejects.toThrow(InvalidSeoResponseError);
  });

  it('posts a new tracker to the collection route', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({ tracker: buildRankTracker() }, 201));
    const request = {
      domain: 'example.com',
      devices: 'mobile',
      depth: 30,
      schedule: 'weekly',
      keywords: ['cheap flights'],
    } satisfies Parameters<typeof createRankTracker>[0];

    await createRankTracker(request);

    expect(sentSeoRequest()).toStrictEqual({
      url: 'https://seo.rank.test.com/api/seo/rank-trackers',
      body: request,
    });
  });

  it('posts the estimate request to the free estimate route', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildRankEstimate()));

    await estimateRankTracker({ tracker_id: 'rt-example' });

    expect(sentSeoRequest().url).toBe('https://seo.rank.test.com/api/seo/rank-trackers/estimate');
  });

  it('starts a run on the tracker runs route and returns the pending run', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      run: buildRankRun({ status: 'pending' }),
      estimated_cost_usd: 0.032,
    }, 202));

    const started = await startRankRun('rt-example');

    expect([sentSeoRequest().url, started.run.status]).toStrictEqual([
      'https://seo.rank.test.com/api/seo/rank-trackers/rt-example/runs', 'pending',
    ]);
  });

  it('reads no latest run for a tracker never checked', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({ run: null }));

    await expect(fetchLatestRankRun('rt-example')).resolves.toBeNull();
  });

  it('asks results for the comparison period', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildRankResults({ period: '30d' })));

    await fetchRankResults('rt-example', '30d');

    expect(sentSeoRequest().url).toBe('https://seo.rank.test.com/api/seo/rank-trackers/rt-example/results?period=30d');
  });

  it('throws InvalidSeoResponseError when results have no rows', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(withoutField(buildRankResults(), 'rows')));

    await expect(fetchRankResults('rt-example', '7d')).rejects.toThrow(InvalidSeoResponseError);
  });

  it('asks one keyword history by keyword id', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      tracker_id: 'rt-example',
      keyword_id: 'kw-1',
      depth: 30,
      points: [],
    }));

    await fetchRankHistory('rt-example', 'kw-1');

    expect(sentSeoRequest().url).toBe('https://seo.rank.test.com/api/seo/rank-trackers/rt-example/history?keyword_id=kw-1');
  });

  it('returns the decoded trend', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildRankTrend()));

    await expect(fetchRankTrend('rt-example', 90)).resolves.toStrictEqual(buildRankTrend());
  });

  it('sends a DELETE to the tracker keywords route with the ids comma-separated', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      keyword_count: 1,
      removed: 2,
    }));

    await removeRankKeywords('rt-example', ['kw-1', 'kw-2']);

    const [url, init] = mockAuthenticatedFetch.mock.calls[0] ?? [];
    expect([url, init?.method]).toStrictEqual([
      'https://seo.rank.test.com/api/seo/rank-trackers/rt-example/keywords?keyword_ids=kw-1%2Ckw-2',
      'DELETE',
    ]);
  });

  it('throws InvalidSeoResponseError when a keyword removal answer has no keyword count', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({ removed: 1 }));

    await expect(removeRankKeywords('rt-example', ['kw-1'])).rejects.toThrow(InvalidSeoResponseError);
  });
});
