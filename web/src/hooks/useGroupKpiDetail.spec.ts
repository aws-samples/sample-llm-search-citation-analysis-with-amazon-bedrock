import {
  describe, expect, it, vi
} from 'vitest';
import { renderHook } from '@testing-library/react';
import {
  useKeywordRuns, useRunDrivers
} from './useGroupKpiDetail';
import { createMockJsonResponse } from '../test/fetchResponses';
import { renderLoadedHook } from '../test/loadedHook';
import { groupScope } from '../components/ui/reportScope-fixtures';
import {
  buildChange, buildDriver, buildRunDrivers, KEYWORD_HISTORIES, RUN_1, RUN_2
} from '../components/Reports/BrandVisibilityReport/groupKpiHistory-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const SOL = groupScope('hotel-sol');
const CHANGE = buildChange();

describe('useKeywordRuns', () => {
  it('reads one keyword of the group over the period', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      keywords: [KEYWORD_HISTORIES[1]],
      next_token: null 
    }));

    await renderLoadedHook(() => useKeywordRuns(SOL, 90, 'hotel sol spa'));

    expect(mockAuthenticatedFetch.mock.calls[0][0]).toBe(
      'https://api.test.com/reports/group-kpis?group_id=hotel-sol&days=90&view=keywords&detail_keyword=hotel+sol+spa',
    );
  });

  it('answers the keyword\'s runs', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      keywords: [KEYWORD_HISTORIES[1]],
      next_token: null 
    }));

    const { result } = await renderLoadedHook(() => useKeywordRuns(SOL, 90, 'hotel sol spa'));

    expect(result.current.history).toStrictEqual(KEYWORD_HISTORIES[1]);
  });

  it('reads nothing without a keyword', () => {
    const { result } = renderHook(() => useKeywordRuns(SOL, 90, null));

    expect([result.current, mockAuthenticatedFetch.mock.calls]).toStrictEqual([{
      history: null,
      loading: false,
      error: null 
    }, []]);
  });

  it('reports a page that is not a keyword page', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({ keywords: 'none' }));

    const { result } = await renderLoadedHook(() => useKeywordRuns(SOL, 90, 'hotel sol spa'));

    expect(result.current.error).toBe('Invalid visibility request');
  });
});

describe('useRunDrivers', () => {
  it('reads only the run and the group run before it', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      changes: [buildRunDrivers()],
      next_token: null 
    }));

    await renderLoadedHook(() => useRunDrivers(SOL, RUN_2, CHANGE));

    expect(mockAuthenticatedFetch.mock.calls[0][0]).toBe(
      `https://api.test.com/reports/group-kpis?group_id=hotel-sol&view=drivers&from_run=${encodeURIComponent(RUN_1)}&to_run=${encodeURIComponent(RUN_2)}`,
    );
  });

  it('answers the drivers of the run', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      changes: [buildRunDrivers()],
      next_token: null 
    }));

    const { result } = await renderLoadedHook(() => useRunDrivers(SOL, RUN_2, CHANGE));

    expect(result.current.drivers).toStrictEqual([buildDriver()]);
  });

  it('answers no drivers when the page holds another run', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
      changes: [buildRunDrivers({ timestamp: RUN_1 })],
      next_token: null 
    }));

    const { result } = await renderLoadedHook(() => useRunDrivers(SOL, RUN_2, CHANGE));

    expect(result.current.drivers).toBeNull();
  });

  it('reports a failed read', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 500));

    const { result } = await renderLoadedHook(() => useRunDrivers(SOL, RUN_2, CHANGE));

    expect(result.current.error).toBe('Failed to load visibility metrics');
  });
});
