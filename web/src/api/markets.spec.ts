import {
  describe, expect, it, vi
} from 'vitest';
import {
  fetchMarkets, MarketsError, MarketsInUseError, proposeMarket, saveMarkets, suggestMarketKeywords
} from './markets';
import {
  mockApiGet, mockApiPost, mockApiPut
} from './clientMock-fixtures';
import {
  BRAZIL, buildMarketProposal, CHILE, SANTIAGO, SANTIAGO_REQUEST
} from '../components/Markets/markets-fixtures';

vi.mock('./client', () => import('./clientMock-fixtures'));

describe('fetchMarkets', () => {
  it('returns the markets and the save time of the listing', async () => {
    mockApiGet.mockResolvedValue({
      markets: [CHILE, SANTIAGO],
      updated_at: '2026-09-18T09:00:00Z',
    });

    await expect(fetchMarkets()).resolves.toStrictEqual({
      markets: [CHILE, SANTIAGO],
      updated_at: '2026-09-18T09:00:00Z',
    });
  });

  it('reads a never-saved list as having no save time', async () => {
    mockApiGet.mockResolvedValue({ markets: [] });

    await expect(fetchMarkets()).resolves.toStrictEqual({
      markets: [],
      updated_at: null,
    });
  });

  it('drops members the dashboard does not know', async () => {
    mockApiGet.mockResolvedValue({
      markets: [{
        ...CHILE,
        unexpected: 'value',
      }],
      updated_at: null,
    });

    await expect(fetchMarkets()).resolves.toStrictEqual({
      markets: [CHILE],
      updated_at: null,
    });
  });

  it('asks GET /markets with the abort signal', async () => {
    mockApiGet.mockResolvedValue({ markets: [] });
    const controller = new AbortController();

    await fetchMarkets(controller.signal);

    expect(mockApiGet).toHaveBeenCalledWith('/markets', { signal: controller.signal });
  });

  it.each([
    ['nothing', null],
    ['no list', { updated_at: null }],
    ['a market without a currency', {
      markets: [{
        ...CHILE,
        currency: undefined,
      }] 
    }],
    ['a text latitude', {
      markets: [{
        ...CHILE,
        lat: '-33',
        lng: -70,
      }] 
    }],
    ['competitors that are not names', {
      markets: [{
        ...CHILE,
        competitors: [1],
      }] 
    }],
    ['a numeric save time', {
      markets: [],
      updated_at: 5,
    }],
  ])('refuses a listing with %s', async (_description, payload) => {
    mockApiGet.mockResolvedValue(payload);

    await expect(fetchMarkets()).rejects.toThrow('Markets API returned an invalid market list');
  });
});

describe('saveMarkets', () => {
  it('puts the whole list and returns what the server stored', async () => {
    mockApiPut.mockResolvedValue({
      markets: [CHILE, BRAZIL],
      updated_at: '2026-09-19T10:00:00Z',
    });

    await expect(saveMarkets([CHILE, BRAZIL])).resolves.toStrictEqual({
      markets: [CHILE, BRAZIL],
      updated_at: '2026-09-19T10:00:00Z',
    });
  });

  it('keeps the 400 and 409 refusal bodies readable', async () => {
    mockApiPut.mockResolvedValue({ markets: [] });

    await saveMarkets([]);

    expect(mockApiPut).toHaveBeenCalledWith('/markets', { markets: [] }, { acceptedJsonStatuses: [400, 409] });
  });

  it('throws the markets keywords still use when the server answers 409', async () => {
    mockApiPut.mockResolvedValue({
      error: 'Markets still used by keywords',
      market_ids: ['br-pt'],
    });

    await expect(saveMarkets([CHILE])).rejects.toStrictEqual(new MarketsInUseError('Markets still used by keywords', ['br-pt']));
  });

  it('names the markets still in use on the error', async () => {
    mockApiPut.mockResolvedValue({
      error: 'Markets still used by keywords',
      market_ids: ['br-pt', 'cl-es'],
    });

    const failure: unknown = await saveMarkets([]).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(MarketsInUseError);
    expect((failure as MarketsInUseError).marketIds).toStrictEqual(['br-pt', 'cl-es']);
  });

  it('throws the validation message of a 400', async () => {
    mockApiPut.mockResolvedValue({ error: 'Market 1: country is not valid' });

    await expect(saveMarkets([CHILE])).rejects.toThrow(MarketsError);
    await expect(saveMarkets([CHILE])).rejects.toThrow('Market 1: country is not valid');
  });
});

describe('suggestMarketKeywords', () => {
  it('posts the keyword and the markets', async () => {
    mockApiPost.mockResolvedValue({ suggestions: [] });

    await suggestMarketKeywords('cheap flights to Lima', ['cl-es', 'br-pt']);

    expect(mockApiPost).toHaveBeenCalledWith('/markets', {
      keyword: 'cheap flights to Lima',
      market_ids: ['cl-es', 'br-pt'],
    }, {
      signal: undefined,
      acceptedJsonStatuses: [400, 502],
    });
  });

  it('returns one local wording per market', async () => {
    mockApiPost.mockResolvedValue({
      suggestions: [
        {
          market_id: 'cl-es',
          keyword: 'pasajes baratos a Lima',
        },
        {
          market_id: 'br-pt',
          keyword: 'passagens baratas para Lima',
        },
      ],
    });

    await expect(suggestMarketKeywords('cheap flights to Lima', ['cl-es', 'br-pt'])).resolves.toStrictEqual([
      {
        market_id: 'cl-es',
        keyword: 'pasajes baratos a Lima',
      },
      {
        market_id: 'br-pt',
        keyword: 'passagens baratas para Lima',
      },
    ]);
  });

  it('throws the refusal of an unknown market', async () => {
    mockApiPost.mockResolvedValue({ error: "Unknown market 'xx'" });

    await expect(suggestMarketKeywords('flights', ['xx'])).rejects.toThrow("Unknown market 'xx'");
  });

  it('refuses suggestions without a keyword', async () => {
    mockApiPost.mockResolvedValue({ suggestions: [{ market_id: 'cl-es' }] });

    await expect(suggestMarketKeywords('flights', ['cl-es'])).rejects.toThrow('Markets API returned invalid suggestions');
  });
});

describe('proposeMarket', () => {
  it('posts the choice under "propose", keeping the 400 and 502 bodies readable', async () => {
    mockApiPost.mockResolvedValue(buildMarketProposal());
    const controller = new AbortController();

    await proposeMarket(SANTIAGO_REQUEST, controller.signal);

    expect(mockApiPost).toHaveBeenCalledWith('/markets', { propose: SANTIAGO_REQUEST }, {
      signal: controller.signal,
      acceptedJsonStatuses: [400, 502],
    });
  });

  it('returns the proposed market and whether its id is already configured', async () => {
    mockApiPost.mockResolvedValue({
      market: SANTIAGO,
      market_id_taken: true,
    });

    await expect(proposeMarket(SANTIAGO_REQUEST)).resolves.toStrictEqual({
      market: SANTIAGO,
      market_id_taken: true,
    });
  });

  it('drops members of the proposed market the dashboard does not know', async () => {
    mockApiPost.mockResolvedValue({
      market: {
        ...CHILE,
        confidence: 0.9,
      },
      market_id_taken: false,
    });

    await expect(proposeMarket(SANTIAGO_REQUEST)).resolves.toStrictEqual(buildMarketProposal({ market: CHILE }));
  });

  it.each([
    ['the refused field', 'propose.country is not valid'],
    ['the model failing', 'The model could not describe this market; fill the fields in by hand'],
  ])('throws the refusal naming %s', async (_description, error) => {
    mockApiPost.mockResolvedValue({ error });

    await expect(proposeMarket(SANTIAGO_REQUEST)).rejects.toThrow(MarketsError);
    await expect(proposeMarket(SANTIAGO_REQUEST)).rejects.toThrow(error);
  });

  it.each([
    ['no market', { market_id_taken: false }],
    ['a market without a time zone', {
      market: {
        ...CHILE,
        timezone: undefined,
      },
      market_id_taken: false,
    }],
    ['no word on the id', { market: CHILE }],
  ])('refuses a proposal with %s', async (_description, payload) => {
    mockApiPost.mockResolvedValue(payload);

    await expect(proposeMarket(SANTIAGO_REQUEST)).rejects.toThrow('Markets API returned an invalid market proposal');
  });
});
