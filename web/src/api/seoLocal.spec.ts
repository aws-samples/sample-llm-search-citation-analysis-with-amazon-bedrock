import {
  describe, expect, it, vi
} from 'vitest';
import {
  fetchLocalJob, searchBusinesses, startLocalJob
} from './seoLocal';
import {
  buildGridJob, buildSearchResponse, buildStartJobResponse
} from './seoLocal-fixtures';
import { InvalidSeoResponseError } from './seoDecoders';
import {
  answerSeoRequestsWith, sentSeoRequest
} from './seo-fixtures';

vi.mock('../infrastructure/config', async () => (await import('../test/seoConfigMock'))
  .buildSeoConfigMock('https://seo.local.example.com/api'));
vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

describe('searchBusinesses', () => {
  it('posts the search to the local businesses route', async () => {
    answerSeoRequestsWith(buildSearchResponse());

    await searchBusinesses({
      query: 'cafe',
      latitude: 40,
      longitude: -74 
    });

    expect(sentSeoRequest()).toStrictEqual({
      url: 'https://seo.local.example.com/api/seo/local/businesses',
      body: {
        query: 'cafe',
        latitude: 40,
        longitude: -74 
      },
    });
  });

  it('throws InvalidSeoResponseError when the answer has no businesses', async () => {
    answerSeoRequestsWith({ cached: false });

    await expect(searchBusinesses({ query: 'bakery' })).rejects.toThrow(InvalidSeoResponseError);
  });
});

describe('startLocalJob', () => {
  it('returns the decoded job answer', async () => {
    answerSeoRequestsWith(buildStartJobResponse());

    await expect(startLocalJob({
      kind: 'grid',
      keyword: 'coffee',
      grid_size: 3,
      spacing_km: 2 
    }))
      .resolves.toStrictEqual(buildStartJobResponse());
  });
});

describe('fetchLocalJob', () => {
  it('reads the job by its id with the target in the query', async () => {
    answerSeoRequestsWith(buildGridJob());

    await fetchLocalJob('abc', { cid: '42' });

    expect(String(sentSeoRequest().url)).toBe('https://seo.local.example.com/api/seo/local/jobs/abc?cid=42');
  });
});
