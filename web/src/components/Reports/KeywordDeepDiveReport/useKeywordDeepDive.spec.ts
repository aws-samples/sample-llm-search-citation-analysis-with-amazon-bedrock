import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import { useKeywordDeepDive } from './useKeywordDeepDive';
import { settledSlice } from '../scopeReport/scopeReport-fixtures';
import {
  buildTrendView, buildVisibility
} from '../layout/reportPayload-fixtures';
import { buildCitationGapsResponse } from '../../Insights/CitationGaps-fixtures';
import {
  buildRecommendationsHookResult, buildRecommendationsResponse
} from '../../Insights/Recommendations-fixtures';
import { brandMentionsExportResponse } from '../../Brands/brandMentionsExport-fixtures';

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

const mockVisibility = vi.mocked(useVisibilityMetrics);
const mockTrends = vi.mocked(useHistoricalTrends);
const mockPersonas = vi.mocked(usePersonaRankings);
const mockMentions = vi.mocked(useBrandMentions);
const mockGaps = vi.mocked(useCitationGaps);
const mockRecommendations = vi.mocked(useRecommendations);

/** The `computing` and `request` fields of a scoped hook that is not computing anything. */
const NOT_COMPUTING = {
  computing: null,
  request: null,
} as const;

/** Renders the hook with a keyword prop so a test can rerender it for another keyword. */
function renderKeywordDeepDive(initialKeyword: string) {
  return renderHook(
    ({ keyword }: { keyword: string | null }) => useKeywordDeepDive(keyword),
    { initialProps: { keyword: initialKeyword } },
  );
}

describe('useKeywordDeepDive', () => {
  const fetchVisibility = vi.fn();
  const fetchTrends = vi.fn();
  const fetchPersonas = vi.fn();
  const fetchGaps = vi.fn();
  const fetchRecs = vi.fn();

  /** Renders the hook for `from`, forgets every fetch so far, then rerenders it for `to`. */
  function renderKeywordChange(from: string, to: string) {
    const { rerender } = renderKeywordDeepDive(from);
    [fetchVisibility, fetchTrends, fetchPersonas, fetchGaps, fetchRecs].forEach((fetch) => fetch.mockClear());
    act(() => {
      rerender({ keyword: to });
    });
  }

  beforeEach(() => {
    mockVisibility.mockReturnValue({
      ...settledSlice(buildVisibility()),
      ...NOT_COMPUTING,
      fetchVisibilityMetrics: fetchVisibility,
    });
    mockTrends.mockReturnValue({
      ...settledSlice(buildTrendView()),
      ...NOT_COMPUTING,
      fetchHistoricalTrends: fetchTrends,
    });
    mockPersonas.mockReturnValue({
      ...settledSlice({
        keyword: 'foo',
        personas: [],
        cross_persona_summary: { brands: [] },
      }),
      fetchPersonaRankings: fetchPersonas,
    });
    mockMentions.mockReturnValue({
      ...settledSlice(brandMentionsExportResponse),
      ...NOT_COMPUTING,
      noData: false,
    });
    mockGaps.mockReturnValue({
      ...settledSlice(buildCitationGapsResponse()),
      ...NOT_COMPUTING,
      noData: false,
      fetchCitationGaps: fetchGaps,
    });
    mockRecommendations.mockReturnValue(buildRecommendationsHookResult({
      ...settledSlice(buildRecommendationsResponse()),
      fetchRecommendations: fetchRecs,
    }));
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
    renderKeywordChange('first', 'second');
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
    renderKeywordChange('first', 'second');
    expect(fetchRecs).toHaveBeenCalledWith(false);
  });

  it('asks for the recommendations of the report keyword', () => {
    renderHook(() => useKeywordDeepDive('Hotel Coruña'));
    expect(mockRecommendations).toHaveBeenLastCalledWith({
      kind: 'keyword',
      keyword: 'Hotel Coruña'
    });
  });

  it('scopes the recommendations to the new keyword when the keyword changes', () => {
    renderKeywordChange('Hotel Coruña', 'Aurora Miles');
    expect(mockRecommendations).toHaveBeenLastCalledWith({
      kind: 'keyword',
      keyword: 'Aurora Miles'
    });
  });

  it('does not refetch when keyword is unchanged across renders', () => {
    renderKeywordChange('stable', 'stable');
    expect(fetchVisibility).not.toHaveBeenCalled();
  });

  it('reports ready=true once every slice has settled with data', () => {
    expect(renderKeywordDeepDive('best running shoes').result.current.ready).toBe(true);
  });

  it('reports ready=false when one slice is still loading', () => {
    mockMentions.mockReturnValue({
      ...NOT_COMPUTING,
      data: null,
      loading: true,
      error: null,
      noData: false,
    });
    expect(renderKeywordDeepDive('best running shoes').result.current.ready).toBe(false);
  });

  it('counts a "no data yet" slice as settled, so the report can still print', () => {
    mockMentions.mockReturnValue({
      ...NOT_COMPUTING,
      data: null,
      loading: false,
      error: null,
      noData: true,
    });
    const { current } = renderKeywordDeepDive('never analysed').result;
    expect(current.ready).toBe(true);
    expect(current.mentionsNoData).toBe(true);
  });
});
