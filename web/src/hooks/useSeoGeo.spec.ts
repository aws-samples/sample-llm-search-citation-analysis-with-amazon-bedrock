import { useSeoGeo } from './useSeoGeo';
import {
  renderHook, waitFor
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  mockFetchSeoGeo, mockIsSeoApiConfigured
} from './useSeoAccount-fixtures';
import { buildSeoGeoResponse } from './useSeoGeo-fixtures';
import { useSelectedMarketId } from '../components/Markets/marketSelectionContext';

vi.mock('../api/seo', () => import('./useSeoAccount-fixtures'));
vi.mock('../components/Markets/marketSelectionContext', () => ({ useSelectedMarketId: vi.fn<typeof useSelectedMarketId>() }));

const RESPONSE = buildSeoGeoResponse();

describe('useSeoGeo without the SEO stack', () => {
  it('reports the SEO stack as not deployed and fetches nothing', () => {
    mockIsSeoApiConfigured.mockReturnValue(false);

    const { result } = renderHook(() => useSeoGeo(null));

    expect(result.current.notConfigured).toBe(true);
    expect(mockFetchSeoGeo).not.toHaveBeenCalledWith(expect.anything());
  });
});

describe('useSeoGeo', () => {
  beforeEach(() => {
    mockIsSeoApiConfigured.mockReturnValue(true);
    vi.mocked(useSelectedMarketId).mockReturnValue(null);
    mockFetchSeoGeo.mockResolvedValue(RESPONSE);
  });

  it('asks for the header market and the keyword group', async () => {
    vi.mocked(useSelectedMarketId).mockReturnValue('ch-de');

    renderHook(() => useSeoGeo('group-geneva'));

    await waitFor(() => expect(mockFetchSeoGeo).toHaveBeenCalledWith({
      market_id: 'ch-de',
      group_id: 'group-geneva',
    }));
  });

  it('asks for the global market when every market is combined', async () => {
    renderHook(() => useSeoGeo(null));

    await waitFor(() => expect(mockFetchSeoGeo).toHaveBeenCalledWith({}));
  });

  it('returns the response once it arrives', async () => {
    const { result } = renderHook(() => useSeoGeo(null));

    await waitFor(() => expect(result.current.data).toStrictEqual(RESPONSE));
  });

  it('reports a failed fetch as an error once it settles', async () => {
    mockFetchSeoGeo.mockRejectedValue(new TypeError('Failed to fetch'));

    const { result } = renderHook(() => useSeoGeo(null));

    await waitFor(() => expect(result.current.ready).toBe(true));
    expect(result.current.error).not.toBeNull();
  });
});
