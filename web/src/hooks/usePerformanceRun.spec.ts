import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fetchLighthouseRun, startLighthouse
} from '../api/seoPerformance';
import {
  RUN_ID, buildRun, buildStartRunResponse
} from '../api/seoPerformance-fixtures';
import { renderStartedRun } from './usePerformanceRun-fixtures';
import { RUN_POLL_INTERVAL_MS } from './usePerformanceRun';
import {
  advanceFakeTime, runEachTestWithFakeTimers
} from '../test/fakeTime';
import { countClearTimeoutsOnUnmount } from '../test/clearTimeoutOnUnmount';

vi.mock('../api/seoPerformance');
vi.mock('../api/seo', () => import('../test/seoApiMock'));

class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

runEachTestWithFakeTimers();

beforeEach(() => {
  vi.mocked(startLighthouse).mockResolvedValue(buildStartRunResponse(buildRun({
    status: 'running',
    results: [null]
  })));
  vi.mocked(fetchLighthouseRun).mockResolvedValue(buildRun());
});

describe('usePerformanceRun', () => {
  it('reads the run again after five seconds and settles once it completes', async () => {
    const { result } = await renderStartedRun();

    await advanceFakeTime(RUN_POLL_INTERVAL_MS);

    expect(result.current.state.status).toBe('done');
  });

  it('reads nothing before the poll interval has passed', async () => {
    await renderStartedRun();

    expect(vi.mocked(fetchLighthouseRun).mock.calls).toStrictEqual([]);
  });

  it('reads the run it started', async () => {
    await renderStartedRun();

    await advanceFakeTime(RUN_POLL_INTERVAL_MS);

    expect(vi.mocked(fetchLighthouseRun).mock.calls[0]?.[0]).toBe(RUN_ID);
  });

  it('starts once and never retries a refused start', async () => {
    vi.mocked(startLighthouse).mockRejectedValue(new RefusedError('refused'));
    const { result } = await renderStartedRun();

    await advanceFakeTime(3 * RUN_POLL_INTERVAL_MS);

    expect([result.current.state, vi.mocked(startLighthouse).mock.calls.length]).toStrictEqual([{
      status: 'error',
      message: 'refused'
    }, 1]);
  });

  it('calls clearTimeout once when the hook unmounts with a read pending', async () => {
    await expect(countClearTimeoutsOnUnmount(renderStartedRun)).resolves.toBe(1);
  });
});
