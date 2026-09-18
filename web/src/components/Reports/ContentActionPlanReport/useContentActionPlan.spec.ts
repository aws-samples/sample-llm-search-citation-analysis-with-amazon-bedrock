import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useContentActionPlan } from './useContentActionPlan';

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

  beforeEach(() => {
    vi.clearAllMocks();
    mockGaps.mockReturnValue({
      data: { top_gaps: [{ url: 'x' }] },
      loading: false,
      error: null,
      fetchCitationGaps,
    });
    mockStudio.mockReturnValue({
      ideas: [{
        id: 'i1',
        priority: 'high' 
      }],
      history: [{
        id: 'h1',
        status: 'generated' 
      }],
      unviewedCount: 0,
      loading: false,
      generating: false,
      error: null,
      fetchIdeas,
      fetchHistory,
      generateContent: vi.fn(),
      markViewed: vi.fn(),
      deleteContent: vi.fn(),
      refreshGeneratingItems: vi.fn(),
    });
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

  it('reports ready=false when citation gaps are still loading', () => {
    mockGaps.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      fetchCitationGaps,
    });
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.ready).toBe(false);
  });

  it('reports ready=false when Content Studio is still loading', () => {
    mockStudio.mockReturnValue({
      ideas: [],
      history: [],
      unviewedCount: 0,
      loading: true,
      generating: false,
      error: null,
      fetchIdeas,
      fetchHistory,
      generateContent: vi.fn(),
      markViewed: vi.fn(),
      deleteContent: vi.fn(),
      refreshGeneratingItems: vi.fn(),
    });
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.ready).toBe(false);
  });

  it('treats Content Studio as ready when ideas present even if history is empty', () => {
    mockStudio.mockReturnValue({
      ideas: [{ id: 'i1' }],
      history: [],
      unviewedCount: 0,
      loading: false,
      generating: false,
      error: null,
      fetchIdeas,
      fetchHistory,
      generateContent: vi.fn(),
      markViewed: vi.fn(),
      deleteContent: vi.fn(),
      refreshGeneratingItems: vi.fn(),
    });
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.ready).toBe(true);
  });

  it('treats Content Studio as ready when history present even if ideas is empty', () => {
    mockStudio.mockReturnValue({
      ideas: [],
      history: [{
        id: 'h1',
        status: 'generated' 
      }],
      unviewedCount: 0,
      loading: false,
      generating: false,
      error: null,
      fetchIdeas,
      fetchHistory,
      generateContent: vi.fn(),
      markViewed: vi.fn(),
      deleteContent: vi.fn(),
      refreshGeneratingItems: vi.fn(),
    });
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.ready).toBe(true);
  });

  it('exposes the citation gaps, ideas, and history as flat data fields', () => {
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.gaps).toStrictEqual({ top_gaps: [{ url: 'x' }] });
    expect(result.current.ideas).toHaveLength(1);
    expect(result.current.history).toHaveLength(1);
  });

  it('propagates errors from each underlying slice', () => {
    mockGaps.mockReturnValue({
      data: null,
      loading: false,
      error: 'gaps boom',
      fetchCitationGaps,
    });
    const { result } = renderHook(() => useContentActionPlan());
    expect(result.current.gapsError).toBe('gaps boom');
  });
});
