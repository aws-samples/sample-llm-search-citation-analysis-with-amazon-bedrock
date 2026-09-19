import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useContentActionPlan } from './useContentActionPlan';
import {
  buildCitationGaps,
  buildGapsSnapshot,
  buildStudioSnapshot,
} from './useContentActionPlan-fixtures';

vi.mock('../../../hooks/useCitationGaps', () => ({useCitationGaps: vi.fn()}));
vi.mock('../../../hooks/useContentStudio', () => ({useContentStudio: vi.fn()}));

import { useCitationGaps } from '../../../hooks/useCitationGaps';
import { useContentStudio } from '../../../hooks/useContentStudio';

const mockGaps = useCitationGaps as ReturnType<typeof vi.fn>;
const mockStudio = useContentStudio as ReturnType<typeof vi.fn>;

describe('useContentActionPlan', () => {
  const fetchCitationGaps = vi.fn();
  const fetchIdeas = vi.fn();
  const fetchHistory = vi.fn();
  const studioFetches = {
    fetchIdeas,
    fetchHistory 
  };
  const citationGaps = buildCitationGaps();

  beforeEach(() => {
    mockGaps.mockReturnValue(buildGapsSnapshot({
      fetchCitationGaps,
      data: citationGaps,
    }));
    mockStudio.mockReturnValue(buildStudioSnapshot({
      ...studioFetches,
      ideaCount: 1,
      briefCount: 1,
    }));
  });

  it('fires the citation-gaps fetch with limit 50 over all keywords', () => {
    renderHook(() => useContentActionPlan());
    expect(fetchCitationGaps).toHaveBeenCalledWith({ kind: 'all' }, 50);
  });

  it('fires the content-studio ideas and history fetches', () => {
    renderHook(() => useContentActionPlan());
    expect(fetchIdeas).toHaveBeenCalledWith();
    expect(fetchHistory).toHaveBeenCalledWith();
  });

  it('reports ready=true once both data sources have settled with content', () => {
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.ready).toBe(true);
  });

  it.each<[source: string, stillLoading: () => void]>([
    ['citation gaps are', () => {
      mockGaps.mockReturnValue(buildGapsSnapshot({
        fetchCitationGaps,
        loading: true,
      }));
    }],
    ['Content Studio is', () => {
      mockStudio.mockReturnValue(buildStudioSnapshot({
        ...studioFetches,
        loading: true,
      }));
    }],
  ])('reports ready=false while %s still loading', (_source, stillLoading) => {
    stillLoading();
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.ready).toBe(false);
  });

  it.each([
    ['ideas present even if history is empty', 1, 0],
    ['history present even if ideas is empty', 0, 1],
  ])('treats Content Studio as ready when %s', (_label, ideaCount, briefCount) => {
    mockStudio.mockReturnValue(buildStudioSnapshot({
      ...studioFetches,
      ideaCount,
      briefCount,
    }));
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.ready).toBe(true);
  });

  it('exposes the citation gaps, ideas, and history as flat data fields', () => {
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.gaps).toStrictEqual(citationGaps);
    expect(result.current.ideas).toHaveLength(1);
    expect(result.current.history).toHaveLength(1);
  });

  it('propagates errors from each underlying slice', () => {
    mockGaps.mockReturnValue(buildGapsSnapshot({
      fetchCitationGaps,
      error: 'gaps boom',
    }));
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.gapsError).toBe('gaps boom');
  });
});
