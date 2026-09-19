import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompetitorGap } from './useCompetitorGap';

vi.mock('../../../hooks/useCompetitorRollup', () => ({useCompetitorRollup: vi.fn()}));

import { useCompetitorRollup } from '../../../hooks/useCompetitorRollup';
import { mockSingleCompetitorRollup } from '../../../hooks/useCompetitorRollup-fixtures';

const mockHook = useCompetitorRollup as ReturnType<typeof vi.fn>;

describe('useCompetitorGap', () => {
  const fetchCompetitorRollup = vi.fn();

  beforeEach(() => {
    mockHook.mockReturnValue({
      data: mockSingleCompetitorRollup,
      loading: false,
      error: null,
      fetchCompetitorRollup,
    });
  });

  it('fetches the rollup with default keyword limit when competitor is set', () => {
    renderHook(() => useCompetitorGap('Adidas'));
    expect(fetchCompetitorRollup).toHaveBeenCalledWith('Adidas', 50);
  });

  it('skips the fetch when competitor is null', () => {
    renderHook(() => useCompetitorGap(null));
    expect(fetchCompetitorRollup).not.toHaveBeenCalled();
  });

  it('exposes the narrowed rollup field for single-competitor responses', () => {
    const { result } = renderHook(() => useCompetitorGap('Adidas'));
    expect(result.current.rollup?.competitor).toBe('Adidas');
  });

  it('returns null rollup for all-competitors response shape', () => {
    mockHook.mockReturnValue({
      data: {
        generated_at: '2026-05-15T07:00:00Z',
        keywords_analyzed: 4,
        competitors: ['Adidas'],
        rollups: [],
      },
      loading: false,
      error: null,
      fetchCompetitorRollup,
    });
    const { result } = renderHook(() => useCompetitorGap('Adidas'));
    expect(result.current.rollup).toBeNull();
  });

  it('reports ready=true once the rollup has loaded for a competitor', () => {
    const { result } = renderHook(() => useCompetitorGap('Adidas'));
    expect(result.current.ready).toBe(true);
  });

  it('reports ready=true even when no competitor is selected (no fetch fires)', () => {
    mockHook.mockReturnValue({
      data: null,
      loading: false,
      error: null,
      fetchCompetitorRollup,
    });
    const { result } = renderHook(() => useCompetitorGap(null));
    expect(result.current.ready).toBe(true);
  });

  it('reports ready=false while the rollup is loading', () => {
    mockHook.mockReturnValue({
      data: null,
      loading: true,
      error: null,
      fetchCompetitorRollup,
    });
    const { result } = renderHook(() => useCompetitorGap('Adidas'));
    expect(result.current.ready).toBe(false);
  });
});
