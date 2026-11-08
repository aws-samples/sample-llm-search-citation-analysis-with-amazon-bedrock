import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { useSeoGeoInsights } from './useSeoGeoInsights';
import {
  act, renderHook, waitFor
} from '@testing-library/react';
import { mockIsSeoApiConfigured } from './useSeoAccount-fixtures';
import { fetchSeoInsights } from '../api/seoDomains';
import { saveRecommendationStatus } from '../api/recommendations';
import {
  buildSeoInsights, buildSeoRecommendation
} from '../api/seoDomains-fixtures';

const headerMarket = vi.hoisted(() => ({ selected: vi.fn<() => string | null>() }));

vi.mock('../api/seo', () => import('./useSeoAccount-fixtures'));
vi.mock('../api/recommendations', () => ({ saveRecommendationStatus: vi.fn() }));
vi.mock('../components/Markets/marketSelectionContext', () => ({ useSelectedMarketId: headerMarket.selected }));
vi.mock('../api/seoDomains', () => ({ fetchSeoInsights: vi.fn() }));

class StatusSaveError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StatusSaveError';
  }
}

beforeEach(() => {
  vi.mocked(fetchSeoInsights).mockResolvedValue(buildSeoInsights());
  headerMarket.selected.mockReturnValue('ch-de');
  mockIsSeoApiConfigured.mockReturnValue(true);
});

describe('useSeoGeoInsights', () => {
  it('asks for the header market and the keyword group', async () => {
    renderHook(() => useSeoGeoInsights('group-geneva'));

    await waitFor(() => {
      expect(fetchSeoInsights).toHaveBeenCalledWith({
        market_id: 'ch-de',
        group_id: 'group-geneva',
      });
    });
  });

  it('fetches nothing without the SEO stack', () => {
    mockIsSeoApiConfigured.mockReturnValue(false);

    const { result } = renderHook(() => useSeoGeoInsights(null));

    expect([result.current.notConfigured, vi.mocked(fetchSeoInsights).mock.calls.length]).toStrictEqual([true, 0]);
  });

  it('applies the status the API saved', async () => {
    vi.mocked(saveRecommendationStatus).mockResolvedValue('in_progress');
    const { result } = renderHook(() => useSeoGeoInsights(null));
    await waitFor(() => {
      expect(result.current.recommendations).toHaveLength(1);
    });

    await act(() => result.current.updateStatus(buildSeoRecommendation(), 'in_progress'));

    expect(result.current.recommendations[0]?.status).toBe('in_progress');
  });

  it('reports a status that was not saved', async () => {
    vi.mocked(saveRecommendationStatus).mockRejectedValue(new StatusSaveError('Status table unavailable'));
    const { result } = renderHook(() => useSeoGeoInsights(null));

    await act(() => result.current.updateStatus(buildSeoRecommendation(), 'done'));

    expect(result.current.statusError).toBe('An unexpected error occurred');
  });
});
