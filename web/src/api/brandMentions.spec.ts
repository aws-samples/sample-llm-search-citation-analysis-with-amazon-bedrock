import {
  describe, expect, it, vi
} from 'vitest';
import {
  brandMentionsExportParams, brandMentionsParams, fetchFirstAppearancesPage, InvalidBrandMentionsResponseError
} from './brandMentions';
import { mockApiGet } from './clientMock-fixtures';
import {
  APPEARANCE_PAGE_1, HOTEL_GROUP, RUN
} from './brandMentions-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

describe('fetchFirstAppearancesPage', () => {
  it('reads the first page of the scope at the requested run', async () => {
    mockApiGet.mockResolvedValue({
      ...APPEARANCE_PAGE_1,
      next_token: null 
    });

    await fetchFirstAppearancesPage({
      scope: HOTEL_GROUP,
      marketId: null,
      filters: { timestamp: RUN } 
    });

    expect(mockApiGet).toHaveBeenCalledWith('/brand-mentions', {
      params: {
        group_id: 'hotel-sol',
        timestamp: RUN,
        view: 'appearances',
        limit: '2000' 
      },
      signal: undefined,
    });
  });

  it('refuses an answer that is not an appearances page', async () => {
    mockApiGet.mockResolvedValue({ aggregated: {} });

    await expect(fetchFirstAppearancesPage({
      scope: HOTEL_GROUP,
      marketId: null,
      filters: {},
    })).rejects.toThrow(InvalidBrandMentionsResponseError);
  });

  it('names its error for the logs', () => {
    expect(new InvalidBrandMentionsResponseError().name).toBe('InvalidBrandMentionsResponseError');
  });
});

describe('brandMentionsExportParams', () => {
  it('holds the scope, market, set filters and brand, without view or paging', () => {
    expect(brandMentionsExportParams({
      scope: HOTEL_GROUP,
      marketId: 'es',
      filters: {
        classification: 'first_party',
        timestamp: null,
      },
      brand: 'Hotel Sol',
    })).toStrictEqual({
      group_id: 'hotel-sol',
      market_id: 'es',
      classification: 'first_party',
      brand: 'Hotel Sol',
    });
  });
});

describe('brandMentionsParams', () => {
  it('leaves out the filters that are not set', () => {
    expect(brandMentionsParams({
      kind: 'keyword',
      keyword: 'hotel sol' 
    }, null, {
      classification: null,
      query_prompt_id: 'familia',
      timestamp: null 
    })).toStrictEqual({
      keyword: 'hotel sol',
      query_prompt_id: 'familia' 
    });
  });
});
