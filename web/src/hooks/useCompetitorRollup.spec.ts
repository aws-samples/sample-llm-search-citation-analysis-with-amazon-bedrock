import {
  describe, it, expect, vi, beforeEach, afterEach,
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useCompetitorRollup } from './useCompetitorRollup';

vi.mock('../infrastructure', async () => {
  const actual = await vi.importActual('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.test.com',
    authenticatedFetch: vi.fn(),
  };
});

import { authenticatedFetch } from '../infrastructure';

const mockFetch = authenticatedFetch as ReturnType<typeof vi.fn>;

const SINGLE_RESPONSE = {
  generated_at: '2026-05-15T07:00:00Z',
  keywords_analyzed: 4,
  competitor: 'Adidas',
  rollup: {
    competitor: 'Adidas',
    outranked_keywords: [],
    exclusive_sources: [],
    outreach_targets: [],
  },
};

const ALL_RESPONSE = {
  generated_at: '2026-05-15T07:00:00Z',
  keywords_analyzed: 4,
  competitors: ['Adidas', 'Asics'],
  rollups: [
    {
      competitor: 'Adidas',
      outranked_keywords: [],
      exclusive_sources: [],
      outreach_targets: [],
    },
  ],
};

function mockOk(payload: unknown) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
  } as unknown as Response;
}

describe('useCompetitorRollup', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null data before fetch', () => {
    const { result } = renderHook(() => useCompetitorRollup());
    expect(result.current.data).toBeNull();
  });

  it('passes the competitor name in the URL when provided', async () => {
    mockFetch.mockResolvedValue(mockOk(SINGLE_RESPONSE));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup('Adidas');
    });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('competitor=Adidas');
  });

  it('URL-encodes competitor names with special characters', async () => {
    mockFetch.mockResolvedValue(mockOk(SINGLE_RESPONSE));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup('Brand & Co');
    });
    const url = mockFetch.mock.calls[0][0] as string;
    // URLSearchParams encodes "Brand & Co" as "Brand+%26+Co" or "Brand+%26+Co"
    expect(url).toMatch(/competitor=Brand(\+|%20)%26(\+|%20)Co/);
  });

  it('honors a custom keyword_limit value in the request URL', async () => {
    mockFetch.mockResolvedValue(mockOk(SINGLE_RESPONSE));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup('Adidas', 75);
    });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('keyword_limit=75');
  });

  it('uses default keyword_limit=50 when not specified', async () => {
    mockFetch.mockResolvedValue(mockOk(SINGLE_RESPONSE));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup();
    });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('keyword_limit=50');
  });

  it('omits competitor param when not provided', async () => {
    mockFetch.mockResolvedValue(mockOk(ALL_RESPONSE));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup();
    });
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).not.toContain('competitor=');
  });

  it('stores the parsed single-competitor response', async () => {
    mockFetch.mockResolvedValue(mockOk(SINGLE_RESPONSE));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup('Adidas');
    });
    expect(result.current.data).toStrictEqual(SINGLE_RESPONSE);
  });

  it('returns the parsed payload from the fetch promise', async () => {
    mockFetch.mockResolvedValue(mockOk(SINGLE_RESPONSE));
    const { result } = renderHook(() => useCompetitorRollup());
    const holder: { value: unknown } = { value: null };
    await act(async () => {
      holder.value = await result.current.fetchCompetitorRollup('Adidas');
    });
    expect(holder.value).toStrictEqual(SINGLE_RESPONSE);
  });

  it('stores the parsed all-competitors response', async () => {
    mockFetch.mockResolvedValue(mockOk(ALL_RESPONSE));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup();
    });
    expect(result.current.data).toStrictEqual(ALL_RESPONSE);
  });

  it('records the error message when the response is not OK', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({}),
    } as unknown as Response);
    const { result } = renderHook(() => useCompetitorRollup());
    const holder: { value: unknown } = { value: 'unset' };
    await act(async () => {
      holder.value = await result.current.fetchCompetitorRollup('Unknown');
    });
    expect(holder.value).toBeNull();
    expect(result.current.error).toBeTruthy();
  });

  it('rejects responses missing both rollup and rollups fields', async () => {
    mockFetch.mockResolvedValue(mockOk({ unrelated: 'shape' }));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup();
    });
    expect(result.current.error).toBeTruthy();
  });

  it('rejects {error} backend responses with a meaningful error message', async () => {
    mockFetch.mockResolvedValue(mockOk({ error: 'Unknown competitor' }));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup('Unknown');
    });
    expect(result.current.error).toBeTruthy();
    expect(result.current.data).toBeNull();
  });

  it('clears the loading flag once the fetch settles', async () => {
    mockFetch.mockResolvedValue(mockOk(SINGLE_RESPONSE));
    const { result } = renderHook(() => useCompetitorRollup());
    await act(async () => {
      await result.current.fetchCompetitorRollup('Adidas');
    });
    expect(result.current.loading).toBe(false);
  });
});
