import {
  describe, expect, it, vi
} from 'vitest';
import { InvalidSeoResponseError } from './seoDecoders';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import {
  fetchSeoAccount, fetchSeoGeo, fetchSerp, isSeoApiConfigured, researchKeywords, seoErrorMessage, UNEXPECTED_ANSWER_MESSAGE
} from './seo';
import {
  buildResearchResponse, buildSeoGeoResponse, buildSerpResponse, sentSeoRequest, withoutField
} from './seo-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));
vi.mock('../infrastructure/config', () => ({
  API_BASE_URL: 'https://api.test.com',
  SEO_API_BASE_URL: 'https://seo.test.com/api',
}));

describe('isSeoApiConfigured', () => {
  it('returns true when the SEO API URL was built in', () => {
    expect(isSeoApiConfigured()).toBe(true);
  });
});

describe('researchKeywords', () => {
  it('posts the request to the SEO API research route', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildResearchResponse()));

    await researchKeywords({
      keyword: 'boutique hotel',
      market_id: 'ch-de',
      limit: 300,
    });

    expect(sentSeoRequest()).toStrictEqual({
      url: 'https://seo.test.com/api/seo/keywords/research',
      body: {
        keyword: 'boutique hotel',
        market_id: 'ch-de',
        limit: 300,
      },
    });
  });

  it('returns the decoded research response', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildResearchResponse()));

    await expect(researchKeywords({ keyword: 'boutique hotel' })).resolves.toStrictEqual(buildResearchResponse());
  });

  it('throws InvalidSeoResponseError when the response has no rows', async () => {
    const withoutRows = withoutField(buildResearchResponse(), 'rows');
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(withoutRows));

    await expect(researchKeywords({ keyword: 'boutique hotel' })).rejects.toThrow(InvalidSeoResponseError);
  });

  it('surfaces the SEO API message of a 502 answer', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      error: 'The DataForSEO account balance is too low',
      code: 'BILLING_ISSUE',
    }, 502));

    const failure: unknown = await researchKeywords({ keyword: 'boutique hotel' }).catch((error: unknown) => error);

    expect(seoErrorMessage(failure)).toBe('The DataForSEO account balance is too low');
  });
});

describe('fetchSerp', () => {
  it('posts the keyword and depth to the SERP route', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildSerpResponse()));

    await fetchSerp({
      keyword: 'boutique hotel',
      depth: 50,
    });

    expect(sentSeoRequest().body).toStrictEqual({
      keyword: 'boutique hotel',
      depth: 50,
    });
  });
});

describe('fetchSeoAccount', () => {
  it('returns the decoded account of the SEO API', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      configured: true,
      login: 'user@example.com',
      balance_usd: 12.5,
    }));

    await expect(fetchSeoAccount()).resolves.toStrictEqual({
      configured: true,
      login: 'user@example.com',
      balance_usd: 12.5,
    });
  });
});

describe('fetchSeoGeo', () => {
  it('sends only the scope parameters that are set', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildSeoGeoResponse()));

    await fetchSeoGeo({ group_id: 'group-1' });

    expect(mockAuthenticatedFetch.mock.calls[0][0]).toBe('https://seo.test.com/api/seo/seo-geo?group_id=group-1');
  });
});

describe('seoErrorMessage', () => {
  it('returns the unexpected-answer message when a response fails its decoder', () => {
    expect(seoErrorMessage(new InvalidSeoResponseError('SEO API returned an invalid account'))).toBe(UNEXPECTED_ANSWER_MESSAGE);
  });

  it('returns the generic server message when a 502 carries no JSON body', async () => {
    mockAuthenticatedFetch.mockResolvedValue(new Response('Bad Gateway', {
      status: 502,
      statusText: 'Bad Gateway',
    }));

    const failure: unknown = await fetchSerp({ keyword: 'boutique hotel' }).catch((error: unknown) => error);

    expect(seoErrorMessage(failure)).toBe('Server error occurred');
  });
});
