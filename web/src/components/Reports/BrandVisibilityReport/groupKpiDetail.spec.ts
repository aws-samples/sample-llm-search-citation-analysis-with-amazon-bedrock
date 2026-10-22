import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { apiGet } from '../../../api/client';
import {
  DRIVER_RUNS_PER_REQUEST,
  fetchAllKeywordRuns,
  fetchAllRunDrivers,
  fetchGroupKpiDetail,
  GroupKpiDetailError,
  mapInBatches,
  slices,
} from './groupKpiDetail';
import {
  buildRunDrivers, KEYWORD_HISTORIES
} from './groupKpiHistory-fixtures';
import {
  comparedRunSeries, dailyRun
} from './groupKpiDetail-fixtures';
import { HOTEL_SOL_SCOPE } from './GroupKpiReport-fixtures';

vi.mock('../../../api/client', () => ({ apiGet: vi.fn() }));

const TARGET = {
  scope: HOTEL_SOL_SCOPE,
  marketId: 'es',
};

describe('fetchAllKeywordRuns', () => {
  beforeEach(() => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce({
        keywords: [KEYWORD_HISTORIES[0]],
        next_token: 'page-2' 
      })
      .mockResolvedValueOnce({
        keywords: [KEYWORD_HISTORIES[1]],
        next_token: null 
      });
  });

  it('collects every page of keyword runs in order', async () => {
    expect(await fetchAllKeywordRuns(TARGET, 90)).toStrictEqual(KEYWORD_HISTORIES);
  });

  it('asks for the keyword view of the group in the market over the period', async () => {
    await fetchAllKeywordRuns(TARGET, 90);

    expect(apiGet).toHaveBeenNthCalledWith(1, '/reports/group-kpis', {
      params: {
        group_id: 'hotel-sol',
        market_id: 'es',
        days: '90',
        view: 'keywords' 
      } 
    });
  });

  it('follows the next token', async () => {
    await fetchAllKeywordRuns(TARGET, 90);

    expect(vi.mocked(apiGet).mock.calls[1][1]?.params).toStrictEqual({
      group_id: 'hotel-sol',
      market_id: 'es',
      days: '90',
      view: 'keywords',
      next_token: 'page-2' 
    });
  });
});

describe('fetchAllKeywordRuns failures', () => {
  it('rejects a malformed page', async () => {
    vi.mocked(apiGet).mockResolvedValue({ keywords: 'none' });

    await expect(fetchAllKeywordRuns(TARGET, 90)).rejects.toThrow('Group KPI API returned an invalid keyword page');
  });

  it('rejects a repeated next token', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      keywords: [],
      next_token: 'again' 
    });

    await expect(fetchAllKeywordRuns(TARGET, 90)).rejects.toThrow(GroupKpiDetailError);
  });
});

describe('fetchAllRunDrivers', () => {
  it('reads the compared runs in slices from the run before each slice to its last run', async () => {
    vi.mocked(apiGet).mockResolvedValue({
      changes: [],
      next_token: null 
    });

    await fetchAllRunDrivers(TARGET, comparedRunSeries(DRIVER_RUNS_PER_REQUEST + 2));

    expect(vi.mocked(apiGet).mock.calls.map(([, options]) => [options?.params?.from_run, options?.params?.to_run])).toStrictEqual([
      [dailyRun(0), dailyRun(DRIVER_RUNS_PER_REQUEST)],
      [dailyRun(DRIVER_RUNS_PER_REQUEST), dailyRun(DRIVER_RUNS_PER_REQUEST + 2)],
    ]);
  });

  it('keeps the drivers of every slice in run order', async () => {
    const first = buildRunDrivers({ timestamp: dailyRun(1) });
    const last = buildRunDrivers({ timestamp: dailyRun(DRIVER_RUNS_PER_REQUEST + 1) });
    vi.mocked(apiGet)
      .mockResolvedValueOnce({
        changes: [first],
        next_token: null 
      })
      .mockResolvedValueOnce({
        changes: [last],
        next_token: null 
      });

    expect(await fetchAllRunDrivers(TARGET, comparedRunSeries(DRIVER_RUNS_PER_REQUEST + 1))).toStrictEqual([first, last]);
  });

  it('reads nothing without a compared run', async () => {
    expect(await fetchAllRunDrivers(TARGET, comparedRunSeries(0))).toStrictEqual([]);
  });

  it('rejects a malformed drivers page', async () => {
    vi.mocked(apiGet).mockResolvedValue({ changes: [{ timestamp: 1 }] });

    await expect(fetchAllRunDrivers(TARGET, comparedRunSeries(1))).rejects.toThrow('Group KPI API returned an invalid drivers page');
  });
});

describe('fetchGroupKpiDetail', () => {
  it('answers every keyword\'s runs and every compared run\'s drivers', async () => {
    const drivers = buildRunDrivers({ timestamp: dailyRun(1) });
    vi.mocked(apiGet).mockImplementation(async (_path, options) => (options?.params?.view === 'keywords'
      ? {
        keywords: KEYWORD_HISTORIES,
        next_token: null 
      }
      : {
        changes: [drivers],
        next_token: null 
      }));

    expect(await fetchGroupKpiDetail(TARGET, 30, comparedRunSeries(1))).toStrictEqual({
      keywords: KEYWORD_HISTORIES,
      drivers: [drivers],
    });
  });
});

describe('slices', () => {
  it('cuts a list into consecutive slices, the last one shorter', () => {
    expect(slices([1, 2, 3, 4, 5], 2)).toStrictEqual([[1, 2], [3, 4], [5]]);
  });

  it('answers no slice for an empty list', () => {
    expect(slices([], 3)).toStrictEqual([]);
  });
});

describe('mapInBatches', () => {
  it('keeps the results in the order of the items', async () => {
    expect(await mapInBatches([3, 1, 2], 2, async (item) => item * 10)).toStrictEqual([30, 10, 20]);
  });

  it('runs at most the limit of loads at once', async () => {
    const inFlight = {
      now: 0,
      most: 0 
    };

    await mapInBatches([1, 2, 3, 4, 5], 2, async () => {
      inFlight.now += 1;
      inFlight.most = Math.max(inFlight.most, inFlight.now);
      await Promise.resolve();
      inFlight.now -= 1;
    });

    expect(inFlight.most).toBe(2);
  });
});
