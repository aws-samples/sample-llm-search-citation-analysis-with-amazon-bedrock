import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useBrandVisibilityReport } from './useBrandVisibilityReport';

vi.mock('../../../hooks/useVisibilityMetrics', () => ({useVisibilityMetrics: vi.fn()}));
vi.mock('../../../hooks/useHistoricalTrends', () => ({useHistoricalTrends: vi.fn()}));
vi.mock('../../../hooks/useGroupKpiHistory', () => ({useGroupKpiHistory: vi.fn()}));

import { useVisibilityMetrics } from '../../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../../hooks/useHistoricalTrends';
import { useGroupKpiHistory } from '../../../hooks/useGroupKpiHistory';
import { ALL_SCOPE } from '../../ui/reportScope';
import { keywordScope as kw } from '../../ui/reportScope-fixtures';
import {
  failedSlice, LOADING_SLICE, settledSlice
} from '../layout/reportSlice-fixtures';
import type { ReportSlice } from '../layout/sectionGate';
import {
  buildTrendView, buildVisibility
} from '../layout/reportPayload-fixtures';

const VISIBILITY = buildVisibility();
const TRENDS = buildTrendView();

const mockVisibility = useVisibilityMetrics as ReturnType<typeof vi.fn>;
const mockTrends = useHistoricalTrends as ReturnType<typeof vi.fn>;
const mockGroupHistory = useGroupKpiHistory as ReturnType<typeof vi.fn>;

const HOTEL_GROUP = {
  kind: 'group',
  groupId: 'hotel-sol' 
} as const;

const EMPTY_HISTORY = {
  runs: [],
  keywords: [],
};

const fetchVisibilityMetrics = vi.fn();
const fetchHistoricalTrends = vi.fn();
const fetchGroupKpiHistory = vi.fn();

function mockVisibilitySlice(slice: ReportSlice<unknown>): void {
  mockVisibility.mockReturnValue({
    ...slice,
    fetchVisibilityMetrics,
  });
}

function mockTrendsSlice(slice: ReportSlice<unknown>): void {
  mockTrends.mockReturnValue({
    ...slice,
    fetchHistoricalTrends,
  });
}

function mockGroupHistorySlice(slice: ReportSlice<unknown>): void {
  mockGroupHistory.mockReturnValue({
    ...slice,
    fetchGroupKpiHistory,
  });
}

describe('useBrandVisibilityReport', () => {
  beforeEach(() => {
    mockVisibilitySlice(settledSlice(VISIBILITY));
    mockTrendsSlice(settledSlice(TRENDS));
    mockGroupHistorySlice(settledSlice(null));
  });

  it('fetches visibility and trends in per-keyword mode', () => {
    renderHook(() => useBrandVisibilityReport(kw('best running shoes'), 90));
    expect(fetchVisibilityMetrics).toHaveBeenCalledWith(kw('best running shoes'));
  });

  it('fetches keyword-scoped trends in per-keyword mode', () => {
    renderHook(() => useBrandVisibilityReport(kw('best running shoes'), 90));
    expect(fetchHistoricalTrends).toHaveBeenCalledWith(kw('best running shoes'), 'day', 30);
  });

  it('skips visibility fetch in all-keywords mode to avoid N+1', () => {
    renderHook(() => useBrandVisibilityReport(ALL_SCOPE, 90));
    expect(fetchVisibilityMetrics).not.toHaveBeenCalledWith(ALL_SCOPE);
  });

  it('fetches cross-keyword trends in all-keywords mode', () => {
    renderHook(() => useBrandVisibilityReport(ALL_SCOPE, 90));
    expect(fetchHistoricalTrends).toHaveBeenCalledWith(ALL_SCOPE, 'day', 30);
  });

  it('fetches the group KPI history for the chosen period in group mode', () => {
    renderHook(() => useBrandVisibilityReport(HOTEL_GROUP, 180));
    expect(fetchGroupKpiHistory).toHaveBeenCalledWith(HOTEL_GROUP, 180);
  });

  it('fetches neither trends nor visibility in group mode', () => {
    renderHook(() => useBrandVisibilityReport(HOTEL_GROUP, 90));
    expect(fetchHistoricalTrends).not.toHaveBeenCalledWith(HOTEL_GROUP, 'day', 30);
    expect(fetchVisibilityMetrics).not.toHaveBeenCalledWith(HOTEL_GROUP);
  });

  it('refetches the group history when the period changes', () => {
    const { rerender } = renderHook(({ days }) => useBrandVisibilityReport(HOTEL_GROUP, days), { initialProps: { days: 90 } });
    rerender({ days: 365 });
    expect(fetchGroupKpiHistory).toHaveBeenLastCalledWith(HOTEL_GROUP, 365);
  });

  it('never fetches the group history outside group mode', () => {
    renderHook(() => useBrandVisibilityReport(ALL_SCOPE, 90));
    expect(fetchGroupKpiHistory).not.toHaveBeenCalledWith(ALL_SCOPE, 90);
  });

  it('reports ready=true once both slices have settled in per-keyword mode', () => {
    const { result } = renderHook(() => useBrandVisibilityReport(kw('shoes'), 90));
    expect(result.current.ready).toBe(true);
  });


  it('waits for the group history before a group report is ready', () => {
    const { result } = renderHook(() => useBrandVisibilityReport(HOTEL_GROUP, 90));
    expect(result.current.ready).toBe(false);
  });

  it('is ready once the group history settled, whatever the trends slice says', () => {
    mockTrendsSlice(LOADING_SLICE);
    mockGroupHistorySlice(settledSlice(EMPTY_HISTORY));
    const { result } = renderHook(() => useBrandVisibilityReport(HOTEL_GROUP, 90));
    expect(result.current.ready).toBe(true);
  });

  it('hands the keyword visibility to a per-keyword report', () => {
    const { result } = renderHook(() => useBrandVisibilityReport(kw('shoes'), 90));
    expect(result.current.visibility).toStrictEqual(VISIBILITY);
  });

  it('hands the trend to a per-keyword report', () => {
    const { result } = renderHook(() => useBrandVisibilityReport(kw('shoes'), 90));
    expect(result.current.trends).toStrictEqual(TRENDS);
  });

  it('hands no keyword visibility to a group report', () => {
    const { result } = renderHook(() => useBrandVisibilityReport(HOTEL_GROUP, 90));
    expect(result.current.visibility).toBeNull();
  });

  it.each([
    ['a per-keyword report', 'trends', mockTrendsSlice, kw('shoes'), false],
    ['a per-keyword report', 'visibility', mockVisibilitySlice, kw('shoes'), false],
    ['an all-keywords report', 'visibility', mockVisibilitySlice, ALL_SCOPE, true],
  ] as const)('readiness of %s while the %s slice loads is %s', (_label, _slice, mockSlice, scope, ready) => {
    mockSlice(LOADING_SLICE);
    const { result } = renderHook(() => useBrandVisibilityReport(scope, 90));
    expect(result.current.ready).toBe(ready);
  });

  it('hands no keyword visibility on a failed request', () => {
    mockVisibilitySlice(failedSlice('boom'));
    const { result } = renderHook(() => useBrandVisibilityReport(kw('shoes'), 90));
    expect(result.current.visibility).toBeNull();
  });

  it('hands the group history to the report', () => {
    mockGroupHistorySlice(settledSlice(EMPTY_HISTORY, 'partial'));
    const { result } = renderHook(() => useBrandVisibilityReport(HOTEL_GROUP, 90));
    expect([result.current.groupHistory, result.current.groupHistoryError]).toStrictEqual([EMPTY_HISTORY, 'partial']);
  });
});
