import {
  describe, it, expect, vi, beforeEach
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useScopeReportData } from './useScopeReportData';
import {
  ALL_SCOPE, groupScope, keywordScope
} from '../../ui/reportScope-fixtures';
import {
  buildTrendView, buildVisibility
} from '../layout/reportPayload-fixtures';
import {
  NETWORK_ERROR, settledSlice
} from './scopeReport-fixtures';

vi.mock('../../../hooks/useHistoricalTrends', () => ({ useHistoricalTrends: vi.fn() }));
vi.mock('../../../hooks/useVisibilityMetrics', () => ({ useVisibilityMetrics: vi.fn() }));

import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';

const VISIBILITY = buildVisibility();
const TRENDS = buildTrendView();
const fetchVisibilityMetrics = vi.fn();
const fetchHistoricalTrends = vi.fn();

describe('useScopeReportData', () => {
  beforeEach(() => {
    vi.mocked(useVisibilityMetrics).mockReturnValue({
      ...settledSlice(VISIBILITY),
      fetchVisibilityMetrics,
    });
    vi.mocked(useHistoricalTrends).mockReturnValue({
      ...settledSlice(TRENDS),
      fetchHistoricalTrends,
    });
  });

  it('fetches the latest runs of the scope', () => {
    renderHook(() => useScopeReportData(keywordScope('best running shoes'), 30));

    expect(fetchVisibilityMetrics).toHaveBeenCalledWith(keywordScope('best running shoes'));
  });

  it.each([
    [30, 'day'],
    [90, 'week'],
    [180, 'week'],
  ] as const)('fetches %s days of trend per %s', (days, period) => {
    renderHook(() => useScopeReportData(groupScope('hotel-sol'), days));

    expect(fetchHistoricalTrends).toHaveBeenCalledWith(groupScope('hotel-sol'), period, days);
  });

  it('reports the period of the trend it fetched', () => {
    const { result } = renderHook(() => useScopeReportData(ALL_SCOPE, 90));

    expect([result.current.days, result.current.period]).toStrictEqual([90, 'week']);
  });

  it('reports the scope it covers, for sections that fetch more of it', () => {
    const { result } = renderHook(() => useScopeReportData(groupScope('hotel-sol'), 30));

    expect(result.current.scope).toStrictEqual(groupScope('hotel-sol'));
  });

  it('refetches only the trend when the period changes', () => {
    const { rerender } = renderHook(({ days }) => useScopeReportData(ALL_SCOPE, days), { initialProps: { days: 30 } });
    rerender({ days: 180 });

    expect(fetchVisibilityMetrics.mock.calls).toStrictEqual([[ALL_SCOPE]]);
    expect(fetchHistoricalTrends).toHaveBeenLastCalledWith(ALL_SCOPE, 'week', 180);
  });

  it('refetches both when the scope changes', () => {
    const { rerender } = renderHook(({ scope }) => useScopeReportData(scope, 30), { initialProps: { scope: ALL_SCOPE } });
    rerender({ scope: keywordScope('best hiking boots') });

    expect(fetchVisibilityMetrics).toHaveBeenLastCalledWith(keywordScope('best hiking boots'));
    expect(fetchHistoricalTrends).toHaveBeenLastCalledWith(keywordScope('best hiking boots'), 'day', 30);
  });

  it('does not refetch when rerendered with an equal scope', () => {
    const { rerender } = renderHook(({ scope }) => useScopeReportData(scope, 30), { initialProps: { scope: groupScope('hotel-sol') } });
    rerender({ scope: groupScope('hotel-sol') });

    expect(fetchVisibilityMetrics.mock.calls).toStrictEqual([[groupScope('hotel-sol')]]);
  });

  it('hands over both payloads', () => {
    const { result } = renderHook(() => useScopeReportData(ALL_SCOPE, 30));

    expect(result.current.visibility).toStrictEqual(settledSlice(VISIBILITY));
    expect(result.current.trends).toStrictEqual(settledSlice(TRENDS));
  });

  it('is ready once both fetches settled', () => {
    const { result } = renderHook(() => useScopeReportData(ALL_SCOPE, 30));

    expect(result.current.ready).toBe(true);
  });

  it('is not ready while the trend is in flight', () => {
    vi.mocked(useHistoricalTrends).mockReturnValue({
      data: null,
      loading: true,
      error: null,
      fetchHistoricalTrends,
    });
    const { result } = renderHook(() => useScopeReportData(ALL_SCOPE, 30));

    expect(result.current.ready).toBe(false);
  });

  it('is ready when a fetch failed, so a report with an error still prints', () => {
    vi.mocked(useVisibilityMetrics).mockReturnValue({
      data: null,
      loading: false,
      error: NETWORK_ERROR,
      fetchVisibilityMetrics,
    });
    const { result } = renderHook(() => useScopeReportData(ALL_SCOPE, 30));

    expect(result.current.ready).toBe(true);
  });
});
