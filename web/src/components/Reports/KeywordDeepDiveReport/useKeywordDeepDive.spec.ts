import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useKeywordDeepDive } from './useKeywordDeepDive';
import { settledSlice } from './useKeywordDeepDive-fixtures';


vi.mock('../../../hooks/useVisibilityMetrics', () => ({useVisibilityMetrics: vi.fn(),}));
vi.mock('../../../hooks/useHistoricalTrends', () => ({useHistoricalTrends: vi.fn(),}));
vi.mock('../../../hooks/usePersonaRankings', () => ({usePersonaRankings: vi.fn(),}));
vi.mock('../../../hooks/useBrandMentions', () => ({useBrandMentions: vi.fn(),}));
vi.mock('../../../hooks/useCitationGaps', () => ({useCitationGaps: vi.fn(),}));
vi.mock('../../../hooks/useRecommendations', () => ({useRecommendations: vi.fn(),}));

import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../../hooks/usePersonaRankings';
import { useBrandMentions } from '../../../hooks/useBrandMentions';
import { useCitationGaps } from '../../../hooks/useCitationGaps';
import { useRecommendations } from '../../../hooks/useRecommendations';

const mockVisibility = useVisibilityMetrics as ReturnType<typeof vi.fn>;
const mockTrends = useHistoricalTrends as ReturnType<typeof vi.fn>;
const mockPersonas = usePersonaRankings as ReturnType<typeof vi.fn>;
const mockMentions = useBrandMentions as ReturnType<typeof vi.fn>;
const mockGaps = useCitationGaps as ReturnType<typeof vi.fn>;
const mockRecommendations = useRecommendations as ReturnType<typeof vi.fn>;

describe('useKeywordDeepDive', () => {
  const fetchVisibility = vi.fn();
  const fetchTrends = vi.fn();
  const fetchPersonas = vi.fn();
  const fetchGaps = vi.fn();
  const fetchRecs = vi.fn();

  beforeEach(() => {
    mockVisibility.mockReturnValue({
      ...settledSlice({ keyword: 'foo' }),
      fetchVisibilityMetrics: fetchVisibility,
    });
    mockTrends.mockReturnValue({
      ...settledSlice({ trend_data: [] }),
      fetchHistoricalTrends: fetchTrends,
    });
    mockPersonas.mockReturnValue({
      ...settledSlice({ personas: [] }),
      fetchPersonaRankings: fetchPersonas,
    });
    mockMentions.mockReturnValue(settledSlice({ aggregated: {} }));
    mockGaps.mockReturnValue({
      ...settledSlice({ gaps: [] }),
      fetchCitationGaps: fetchGaps,
    });
    mockRecommendations.mockReturnValue({
      ...settledSlice({ recommendations: [] }),
      fetchRecommendations: fetchRecs,
    });
  });

  it('does not fetch visibility, trends, or personas when keyword is null', () => {
    renderHook(() => useKeywordDeepDive(null));
    expect(fetchVisibility).not.toHaveBeenCalled();
    expect(fetchTrends).not.toHaveBeenCalled();
    expect(fetchPersonas).not.toHaveBeenCalled();
  });

  it('does not fetch gaps or recommendations when keyword is null', () => {
    renderHook(() => useKeywordDeepDive(null));
    expect(fetchGaps).not.toHaveBeenCalled();
    expect(fetchRecs).not.toHaveBeenCalled();
  });

  it('fires visibility, trends, and persona fetches when keyword is supplied', () => {
    renderHook(() => useKeywordDeepDive('best running shoes'));
    expect(fetchVisibility).toHaveBeenCalledWith({
      kind: 'keyword',
      keyword: 'best running shoes' 
    });
    expect(fetchTrends).toHaveBeenCalledWith({
      kind: 'keyword',
      keyword: 'best running shoes' 
    }, 'day', 30);
    expect(fetchPersonas).toHaveBeenCalledWith('best running shoes');
  });

  it('fires gap and recommendation fetches when keyword is supplied', () => {
    renderHook(() => useKeywordDeepDive('best running shoes'));
    expect(fetchGaps).toHaveBeenCalledWith({
      kind: 'keyword',
      keyword: 'best running shoes' 
    });
    expect(fetchRecs).toHaveBeenCalledWith(false);
  });

  it('refetches every slice when the keyword changes', () => {
    const { rerender } = renderHook(
      ({ keyword }: { keyword: string | null }) => useKeywordDeepDive(keyword),
      { initialProps: { keyword: 'first' } },
    );
    fetchVisibility.mockClear();
    fetchTrends.mockClear();
    fetchPersonas.mockClear();
    fetchGaps.mockClear();
    act(() => {
      rerender({ keyword: 'second' });
    });
    expect(fetchVisibility).toHaveBeenCalledWith({
      kind: 'keyword',
      keyword: 'second' 
    });
    expect(fetchTrends).toHaveBeenCalledWith({
      kind: 'keyword',
      keyword: 'second' 
    }, 'day', 30);
    expect(fetchPersonas).toHaveBeenCalledWith('second');
    expect(fetchGaps).toHaveBeenCalledWith({
      kind: 'keyword',
      keyword: 'second' 
    });
  });

  it('refetches recommendations when the keyword changes', () => {
    const { rerender } = renderHook(
      ({ keyword }: { keyword: string | null }) => useKeywordDeepDive(keyword),
      { initialProps: { keyword: 'first' } },
    );
    fetchRecs.mockClear();
    act(() => {
      rerender({ keyword: 'second' });
    });
    expect(fetchRecs).toHaveBeenCalledWith(false);
  });

  it('does not refetch when keyword is unchanged across renders', () => {
    const { rerender } = renderHook(
      ({ keyword }: { keyword: string | null }) => useKeywordDeepDive(keyword),
      { initialProps: { keyword: 'stable' } },
    );
    fetchVisibility.mockClear();
    act(() => {
      rerender({ keyword: 'stable' });
    });
    expect(fetchVisibility).not.toHaveBeenCalled();
  });

  it('reports ready=true once every slice has settled with data', () => {
    const { result } = renderHook(() =>
      useKeywordDeepDive('best running shoes'),
    );
    expect(result.current.ready).toBe(true);
  });

  it('reports ready=false when one slice is still loading', () => {
    mockMentions.mockReturnValue({
      data: null,
      loading: true,
      error: null 
    });
    const { result } = renderHook(() =>
      useKeywordDeepDive('best running shoes'),
    );
    expect(result.current.ready).toBe(false);
  });
});
