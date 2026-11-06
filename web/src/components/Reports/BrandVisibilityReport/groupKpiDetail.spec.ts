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
  buildRunDrivers, FIRST_KEYWORD_RUNS_PAGE, KEYWORD_HISTORIES, LAST_KEYWORD_RUNS_PAGE
} from './groupKpiHistory-fixtures';
import {
  comparedRunSeries, dailyRun
} from './groupKpiDetail-fixtures';
import { HOTEL_SOL_SCOPE } from './GroupKpiReport-fixtures';
import { ApiRequestError } from '../../../infrastructure';

vi.mock('../../../api/client', () => ({ apiGet: vi.fn() }));

const TARGET = {
  scope: HOTEL_SOL_SCOPE,
  marketId: 'es',
};

describe('fetchAllKeywordRuns', () => {
  beforeEach(() => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(FIRST_KEYWORD_RUNS_PAGE)
      .mockResolvedValueOnce(LAST_KEYWORD_RUNS_PAGE);
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
  it('names the keyword page that timed out when a later page answers 504', async () => {
    vi.mocked(apiGet)
      .mockResolvedValueOnce(FIRST_KEYWORD_RUNS_PAGE)
      .mockRejectedValueOnce(new ApiRequestError('HTTP 504: Gateway Timeout', 504));

    await expect(fetchAllKeywordRuns(TARGET, 90)).rejects.toThrow('Keyword runs, page 2: Request timed out');
  });

  it('passes an abort through unchanged when the caller aborts a keyword page', async () => {
    vi.mocked(apiGet).mockRejectedValue(new DOMException('The operation was aborted.', 'AbortError'));

    await expect(fetchAllKeywordRuns(TARGET, 90)).rejects.toMatchObject({ name: 'AbortError' });
  });
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

  it('names the slice of runs whose drivers failed when a drivers page answers 503', async () => {
    vi.mocked(apiGet).mockRejectedValue(new ApiRequestError('HTTP 503: Service Unavailable', 503));

    await expect(fetchAllRunDrivers(TARGET, comparedRunSeries(1))).rejects.toThrow('Drivers of the runs 2026-09-01 to 2026-09-02: Server error occurred');
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
