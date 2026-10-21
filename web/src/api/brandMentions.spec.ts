import {
  describe, expect, it, vi
} from 'vitest';
import {
  brandMentionsParams, fetchBrandAppearances, InvalidBrandMentionsResponseError
} from './brandMentions';
import { mockApiGet } from './clientMock-fixtures';
import {
  APPEARANCE_PAGE_1, APPEARANCE_PAGE_2, HOTEL_GROUP, RUN
} from './brandMentions-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

/** Every appearance of the hotel group at the latest run, in every market. */
const UNFILTERED_GROUP_READ = {
  scope: HOTEL_GROUP,
  marketId: null,
  filters: {},
};

describe('fetchBrandAppearances', () => {
  it('reads the first page of the scope at the requested run', async () => {
    mockApiGet.mockResolvedValue({
      ...APPEARANCE_PAGE_1,
      next_token: null 
    });

    await fetchBrandAppearances({
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
    });
  });

  it('returns every appearance of every page in page order', async () => {
    mockApiGet.mockResolvedValueOnce(APPEARANCE_PAGE_1).mockResolvedValueOnce(APPEARANCE_PAGE_2);

    const rows = await fetchBrandAppearances({
      scope: HOTEL_GROUP,
      marketId: null,
      filters: {} 
    });

    expect(rows).toStrictEqual([...APPEARANCE_PAGE_1.appearances, ...APPEARANCE_PAGE_2.appearances]);
  });

  it('sends the previous page token and the brand when one is asked for', async () => {
    mockApiGet.mockResolvedValueOnce(APPEARANCE_PAGE_1).mockResolvedValueOnce(APPEARANCE_PAGE_2);

    await fetchBrandAppearances({
      scope: HOTEL_GROUP,
      marketId: 'es',
      filters: { classification: 'first_party' },
      brand: 'Hotel Sol' 
    });

    expect(mockApiGet).toHaveBeenLastCalledWith('/brand-mentions', {
      params: {
        group_id: 'hotel-sol',
        market_id: 'es',
        classification: 'first_party',
        brand: 'Hotel Sol',
        view: 'appearances',
        limit: '2000',
        next_token: APPEARANCE_PAGE_1.next_token,
      },
    });
  });

  it('refuses an answer that is not an appearances page', async () => {
    mockApiGet.mockResolvedValue({ aggregated: {} });

    const read = fetchBrandAppearances(UNFILTERED_GROUP_READ);

    await expect(read).rejects.toThrow(InvalidBrandMentionsResponseError);
  });

  it('refuses a page sequence that repeats a token', async () => {
    mockApiGet.mockResolvedValue(APPEARANCE_PAGE_1);

    const read = fetchBrandAppearances(UNFILTERED_GROUP_READ);

    await expect(read).rejects.toThrow('Brand mentions API repeated a continuation token');
  });

  it('names its error for the logs', () => {
    expect(new InvalidBrandMentionsResponseError().name).toBe('InvalidBrandMentionsResponseError');
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
