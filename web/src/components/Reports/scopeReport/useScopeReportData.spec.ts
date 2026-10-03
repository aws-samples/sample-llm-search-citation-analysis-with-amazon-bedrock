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
  FAILED, IN_FLIGHT, settledSlice
} from './scopeReport-fixtures';
import type { ReportSlice } from '../layout/sectionGate';
import type {
  HistoricalTrendsResponse, ReportScope, VisibilityResponse
} from '../../../types';

vi.mock('../../../hooks/useHistoricalTrends', () => ({ useHistoricalTrends: vi.fn() }));
vi.mock('../../../hooks/useVisibilityMetrics', () => ({ useVisibilityMetrics: vi.fn() }));

import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';

const VISIBILITY = buildVisibility();
const TRENDS = buildTrendView();
const fetchVisibilityMetrics = vi.fn();
const fetchHistoricalTrends = vi.fn();

function mockVisibilitySlice(slice: ReportSlice<VisibilityResponse>) {
  vi.mocked(useVisibilityMetrics).mockReturnValue({
    ...slice,
    fetchVisibilityMetrics,
  });
}

function mockTrendSlice(slice: ReportSlice<HistoricalTrendsResponse>) {
  vi.mocked(useHistoricalTrends).mockReturnValue({
    ...slice,
    fetchHistoricalTrends,
  });
}

function renderScopeReportData(scope: ReportScope = ALL_SCOPE, days = 30) {
  return renderHook(() => useScopeReportData(scope, days)).result;
}

describe('useScopeReportData', () => {
  beforeEach(() => {
    mockVisibilitySlice(settledSlice(VISIBILITY));
    mockTrendSlice(settledSlice(TRENDS));
  });

  it('fetches the latest runs of the scope', () => {
    renderScopeReportData(keywordScope('best running shoes'));

    expect(fetchVisibilityMetrics).toHaveBeenCalledWith(keywordScope('best running shoes'));
  });

  it.each([
    [30, 'day'],
    [90, 'week'],
    [180, 'week'],
  ] as const)('fetches %s days of trend per %s', (days, period) => {
    renderScopeReportData(groupScope('hotel-sol'), days);

    expect(fetchHistoricalTrends).toHaveBeenCalledWith(groupScope('hotel-sol'), period, days);
  });

  it('reports the period of the trend it fetched', () => {
    const result = renderScopeReportData(ALL_SCOPE, 90);

    expect([result.current.days, result.current.period]).toStrictEqual([90, 'week']);
  });

  it('reports the scope it covers, for sections that fetch more of it', () => {
    const result = renderScopeReportData(groupScope('hotel-sol'));

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
    const result = renderScopeReportData();

    expect(result.current.visibility).toStrictEqual(settledSlice(VISIBILITY));
    expect(result.current.trends).toStrictEqual(settledSlice(TRENDS));
  });

  it('is ready once both fetches settled', () => {
    expect(renderScopeReportData().current.ready).toBe(true);
  });

  it('is not ready while the trend is in flight', () => {
    mockTrendSlice(IN_FLIGHT);

    expect(renderScopeReportData().current.ready).toBe(false);
  });

  it('is ready when a fetch failed, so a report with an error still prints', () => {
    mockVisibilitySlice(FAILED);

    expect(renderScopeReportData().current.ready).toBe(true);
  });
});
