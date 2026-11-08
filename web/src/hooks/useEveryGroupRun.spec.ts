import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  renderHook, waitFor
} from '@testing-library/react';
import { useEveryGroupRun } from './useEveryGroupRun';
import { answerFetchesInOrder } from '../test/scopedTestKit';
import { scopedFixture } from '../test/scopedFixtures';
import {
  buildHistory, buildRun, RUN_1, RUN_2, RUN_3
} from '../components/Reports/BrandVisibilityReport/groupKpiHistory-fixtures';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

const REQUEST = {
  path: '/reports/group-kpis',
  params: new URLSearchParams({
    group_id: 'group-sol',
    days: '365',
  }),
};
const cutHistory = buildHistory({
  runs: [buildRun({ timestamp: RUN_3 })],
  runs_truncated: true,
  runs_total: 3,
});
const firstPage = {
  runs: [buildRun({ timestamp: RUN_1 }), buildRun({ timestamp: RUN_2 })],
  runs_total: 3,
  next_token: 'after-run-2',
};
const lastPage = {
  runs: [buildRun({ timestamp: RUN_3 })],
  runs_total: 3,
  next_token: null,
};
const cursorExpired = scopedFixture('group-kpis', 'cursor_expired');

describe('useEveryGroupRun', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it('reads nothing when the summary holds every run', () => {
    const { result } = renderHook(() => useEveryGroupRun(buildHistory({ runs_truncated: false }), REQUEST));

    expect([result.current, mockAuthenticatedFetch.mock.calls]).toStrictEqual([{
      runs: null,
      loading: false,
      error: null,
    }, []]);
  });

  it('joins every view=runs page oldest first when the summary was cut', async () => {
    answerFetchesInOrder([firstPage, 200], [lastPage, 200]);
    const { result } = renderHook(() => useEveryGroupRun(cutHistory, REQUEST));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs?.map((run) => run.timestamp)).toStrictEqual([RUN_1, RUN_2, RUN_3]);
  });

  it('asks the first page with view=runs and the second with its cursor', async () => {
    answerFetchesInOrder([firstPage, 200], [lastPage, 200]);
    const { result } = renderHook(() => useEveryGroupRun(cutHistory, REQUEST));

    await waitFor(() => expect(result.current.loading).toBe(false));

    const urls = mockAuthenticatedFetch.mock.calls.map(([url]) => new URL(String(url)).searchParams);
    expect(urls.map((params) => [params.get('view'), params.get('next_token')])).toStrictEqual([['runs', null], ['runs', 'after-run-2']]);
  });

  it('reads the runs again from the first when the cursor expired', async () => {
    answerFetchesInOrder([firstPage, 200], [cursorExpired, 400], [firstPage, 200], [lastPage, 200]);
    const { result } = renderHook(() => useEveryGroupRun(cutHistory, REQUEST));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect(result.current.runs?.map((run) => run.timestamp)).toStrictEqual([RUN_1, RUN_2, RUN_3]);
  });

  it('reports the error when a runs page is refused', async () => {
    answerFetchesInOrder([{ error: 'Invalid view' }, 400]);
    const { result } = renderHook(() => useEveryGroupRun(cutHistory, REQUEST));

    await waitFor(() => expect(result.current.loading).toBe(false));

    expect([result.current.runs, result.current.error]).toStrictEqual([null, 'Invalid request']);
  });
});
