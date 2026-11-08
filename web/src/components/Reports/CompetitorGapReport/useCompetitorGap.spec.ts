import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useCompetitorGap } from './useCompetitorGap';

vi.mock('../../../hooks/useCompetitorRollup', () => ({useCompetitorRollup: vi.fn()}));

import { useCompetitorRollup } from '../../../hooks/useCompetitorRollup';
import { mockSingleCompetitorRollup } from '../../../hooks/useCompetitorRollup-fixtures';
import type { CompetitorReportResponse } from '../../../api/reports';

const mockHook = useCompetitorRollup as ReturnType<typeof vi.fn>;

describe('useCompetitorGap', () => {
  const fetchCompetitorRollup = vi.fn();

  function mockRollupHook(data: CompetitorReportResponse | null, loading = false) {
    mockHook.mockReturnValue({
      data,
      loading,
      error: null,
      fetchCompetitorRollup,
    });
  }

  beforeEach(() => {
    mockRollupHook(mockSingleCompetitorRollup);
  });

  it('fetches the rollup of every keyword when competitor is set without a scope', () => {
    renderHook(() => useCompetitorGap('Adidas'));
    expect(fetchCompetitorRollup).toHaveBeenCalledWith('Adidas', { kind: 'all' });
  });

  it('fetches the rollup of the given keyword group', () => {
    renderHook(() => useCompetitorGap('Adidas', {
      kind: 'group',
      groupId: 'hotel-sol',
    }));
    expect(fetchCompetitorRollup).toHaveBeenCalledWith('Adidas', {
      kind: 'group',
      groupId: 'hotel-sol',
    });
  });

  it('skips the fetch when competitor is null', () => {
    renderHook(() => useCompetitorGap(null));
    expect(fetchCompetitorRollup).not.toHaveBeenCalled();
  });

  it('exposes the narrowed rollup field for single-competitor responses', () => {
    const { result } = renderHook(() => useCompetitorGap('Adidas'));
    expect(result.current.rollup?.competitor).toBe('Adidas');
  });

  it('reports ready=true once the rollup has loaded for a competitor', () => {
    const { result } = renderHook(() => useCompetitorGap('Adidas'));
    expect(result.current.ready).toBe(true);
  });

  it('reports ready=true even when no competitor is selected (no fetch fires)', () => {
    mockRollupHook(null);
    const { result } = renderHook(() => useCompetitorGap(null));
    expect(result.current.ready).toBe(true);
  });

  it('reports ready=false while the rollup is loading', () => {
    mockRollupHook(null, true);
    const { result } = renderHook(() => useCompetitorGap('Adidas'));
    expect(result.current.ready).toBe(false);
  });
});
