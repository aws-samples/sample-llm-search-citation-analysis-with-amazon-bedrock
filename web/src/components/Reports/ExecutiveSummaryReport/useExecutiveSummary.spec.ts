import {
  describe, it, expect, vi, beforeEach,
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useExecutiveSummary } from './useExecutiveSummary';

vi.mock('../../../hooks/useReportsOverview', () => ({useReportsOverview: vi.fn()}));

import { useReportsOverview } from '../../../hooks/useReportsOverview';
import type { ReportsOverviewResponse } from '../../../api/reports';
import type { ReportSlice } from '../layout';
import { buildOverview } from '../layout/reportPayload-fixtures';
import { loadedOverview } from './sections/reportsOverview-fixtures';

const mockOverview = useReportsOverview as ReturnType<typeof vi.fn>;

describe('useExecutiveSummary', () => {
  const fetchReportsOverview = vi.fn();

  function mockOverviewHook(slice: ReportSlice<ReportsOverviewResponse>) {
    mockOverview.mockReturnValue({
      ...slice,
      fetchReportsOverview,
    });
  }

  beforeEach(() => {
    mockOverviewHook(loadedOverview());
  });

  it('fetches the overview with default 30-day window over all keywords', () => {
    renderHook(() => useExecutiveSummary());
    expect(fetchReportsOverview).toHaveBeenCalledWith(30, 'day', 3, { kind: 'all' });
  });

  it('respects a custom days argument', () => {
    renderHook(() => useExecutiveSummary(60));
    expect(fetchReportsOverview).toHaveBeenCalledWith(60, 'day', 3, { kind: 'all' });
  });

  it('narrows the overview to a keyword group', () => {
    renderHook(() => useExecutiveSummary(30, {
      kind: 'group',
      groupId: 'group-coruna' 
    }));
    expect(fetchReportsOverview).toHaveBeenCalledWith(30, 'day', 3, {
      kind: 'group',
      groupId: 'group-coruna' 
    });
  });

  it('reports ready=true once the slice has data', () => {
    const { result } = renderHook(() => useExecutiveSummary());
    expect(result.current.ready).toBe(true);
  });

  it('hands the overview to the report', () => {
    const { result } = renderHook(() => useExecutiveSummary());
    expect(result.current.data).toStrictEqual(buildOverview());
  });

  it('reports ready=false while the overview slice is loading', () => {
    mockOverviewHook({
      data: null,
      loading: true,
      error: null,
    });
    const { result } = renderHook(() => useExecutiveSummary());
    expect(result.current.ready).toBe(false);
  });
});
