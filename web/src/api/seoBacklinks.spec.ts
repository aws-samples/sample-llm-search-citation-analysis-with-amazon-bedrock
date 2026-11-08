import { createMockJsonResponse } from '../test/fetchResponses';
import {
  buildBacklinkRow, buildOverview, buildSnapshots, buildTablePage
} from './seoBacklinks-fixtures';
import { InvalidSeoResponseError } from './seoDecoders';
import { sentSeoRequest } from './seo-fixtures';
import {
  fetchBacklinkSnapshots,
  fetchBacklinksOverview,
  fetchBacklinksTable,
  startBacklinkSnapshots,
} from './seoBacklinks';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  describe, expect, it, vi
} from 'vitest';

vi.mock('../infrastructure/config', () => ({
  SEO_API_BASE_URL: 'https://seo.example.com/prod/api',
  API_BASE_URL: 'https://main.example.com',
}));
vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const TABLE_REQUEST = {
  target: 'example.com',
  page: 2,
  page_size: 100,
  sort_order: 'desc',
  filters: { include: 'blog' },
  include_spam: false,
  mode: 'as_is',
} as const;

describe('fetchBacklinksOverview', () => {
  it('posts the target and scope to the overview route', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildOverview()));

    await fetchBacklinksOverview({
      target: 'example.com',
      scope: 'domain',
    });

    expect(sentSeoRequest()).toStrictEqual({
      url: 'https://seo.example.com/prod/api/seo/backlinks/overview',
      body: {
        target: 'example.com',
        scope: 'domain',
      },
    });
  });

  it('returns the decoded overview', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildOverview()));

    await expect(fetchBacklinksOverview({ target: 'example.com' })).resolves.toStrictEqual(buildOverview());
  });

  it('throws InvalidSeoResponseError when the overview has no trends list', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      ...buildOverview(),
      trends: null,
    }));

    await expect(fetchBacklinksOverview({ target: 'example.com' })).rejects.toThrow(InvalidSeoResponseError);
  });
});

describe('fetchBacklinksTable', () => {
  it('posts a referring domains page to its own route', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildTablePage('referring_domains', [])));

    await fetchBacklinksTable('referring_domains', TABLE_REQUEST);

    expect(sentSeoRequest().url).toBe('https://seo.example.com/prod/api/seo/backlinks/referring-domains');
  });

  it('returns the decoded backlinks page', async () => {
    const page = buildTablePage('backlinks', [buildBacklinkRow()]);
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(page));

    await expect(fetchBacklinksTable('backlinks', TABLE_REQUEST)).resolves.toStrictEqual(page);
  });

  it('throws InvalidSeoResponseError when the answer is another table', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildTablePage('top_pages', [])));

    await expect(fetchBacklinksTable('backlinks', TABLE_REQUEST)).rejects.toThrow(InvalidSeoResponseError);
  });

  it('posts an export chunk window in place of the page', async () => {
    const chunk = {
      target: 'example.com',
      sort_order: 'asc',
      filters: { include: 'blog' },
      include_spam: true,
      offset: 0,
      limit: 1000,
    } as const;
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildTablePage('top_pages', [])));

    await fetchBacklinksTable('top_pages', chunk);

    expect(sentSeoRequest().body).toStrictEqual(chunk);
  });
});

describe('backlink snapshots', () => {
  it('reads the stored snapshots', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildSnapshots()));

    await expect(fetchBacklinkSnapshots()).resolves.toStrictEqual(buildSnapshots());
  });

  it('posts an empty body to start a snapshot run', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      started: true,
      domains: 2,
      estimated_cost_usd: 0.048,
    }));

    await startBacklinkSnapshots();

    expect(sentSeoRequest()).toStrictEqual({
      url: 'https://seo.example.com/prod/api/seo/backlinks/snapshots',
      body: {},
    });
  });
});
