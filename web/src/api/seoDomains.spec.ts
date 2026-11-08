import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  describe, expect, it, vi
} from 'vitest';
import { InvalidSeoResponseError } from './seoDecoders';
import {
  fetchDomainKeywords, fetchDomainOverview, fetchDomainSnapshots, fetchSeoInsights,
  takeDomainSnapshot
} from './seoDomains';
import {
  buildDomainKeywords, buildDomainOverview, buildDomainSnapshots, buildSeoInsights, SNAPSHOT_STARTED
} from './seoDomains-fixtures';
import {
  sentSeoRequest, withoutField
} from './seo-fixtures';

import type { DomainKeywordsRequest } from '../types/api/seoDomains';

vi.mock('../infrastructure/config', () => ({
  SEO_API_BASE_URL: 'https://seo.test.com/api',
  API_BASE_URL: 'https://api.test.com',
}));
vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

describe('fetchDomainOverview', () => {
  it('posts the target to the overview route', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildDomainOverview()));

    await fetchDomainOverview({
      target: 'example.com/blog',
      scope: 'subfolder',
    });

    expect(sentSeoRequest()).toStrictEqual({
      url: 'https://seo.test.com/api/seo/domains/overview',
      body: {
        target: 'example.com/blog',
        scope: 'subfolder',
      },
    });
  });

  it('throws InvalidSeoResponseError when the answer has no figures', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(withoutField(buildDomainOverview(), 'organic_keywords')));

    await expect(fetchDomainOverview({ target: 'example.com' })).rejects.toThrow(InvalidSeoResponseError);
  });
});

describe('fetchDomainKeywords', () => {
  it('sends the page, sort and filters', async () => {
    const request = {
      target: 'example.com',
      page: 2,
      sort: 'volume',
      filters: { min_volume: 10 },
    } satisfies DomainKeywordsRequest;
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildDomainKeywords()));

    await fetchDomainKeywords(request);

    expect(sentSeoRequest().body).toStrictEqual(request);
  });

  it('sends an export chunk as offset and limit', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildDomainKeywords({
      offset: 1000,
      limit: 500,
    })));

    await fetchDomainKeywords({
      target: 'example.com',
      offset: 1000,
      limit: 500,
    });

    expect(sentSeoRequest().body).toStrictEqual({
      target: 'example.com',
      offset: 1000,
      limit: 500,
    });
  });
});

describe('snapshots', () => {
  it.each([
    ['reads the snapshots of a domain from the query string', () => fetchDomainSnapshots({ domain: 'example.com' }),
      buildDomainSnapshots(), 'https://seo.test.com/api/seo/domains/snapshots?domain=example.com'],
    ['posts a snapshot start to the snapshots route', () => takeDomainSnapshot({ domain: 'example.com' }),
      SNAPSHOT_STARTED, 'https://seo.test.com/api/seo/domains/snapshots'],
  ])('%s', async (_name, send, answer, url) => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(answer));

    await send();

    expect(sentSeoRequest().url).toBe(url);
  });
});

describe('fetchSeoInsights', () => {
  it('reads the recommendations of the market and group', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildSeoInsights()));

    await expect(fetchSeoInsights({
      market_id: 'ch-de',
      group_id: 'grp-1',
    })).resolves.toStrictEqual(buildSeoInsights());
  });
});
