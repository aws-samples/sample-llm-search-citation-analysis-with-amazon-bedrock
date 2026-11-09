import { waitFor } from '@testing-library/react';
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
import { liveSubscriberCount } from '../test/liveEventsMock';
import {
  emitSeoJobChanged, waitForDoneAfterSeoJobChanged, waitForJobReads
} from '../test/seoJobEvents';

vi.mock('../api/seoPerformance');
vi.mock('../api/seo', () => import('../test/seoApiMock'));

class RefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RefusedError';
  }
}

const RUNNING = buildRun({
  status: 'running',
  results: [null]
});

beforeEach(() => {
  vi.mocked(startLighthouse).mockResolvedValue(buildStartRunResponse(RUNNING));
  vi.mocked(fetchLighthouseRun).mockResolvedValue(RUNNING);
});

describe('usePerformanceRun', () => {
  it('reads the run it started once when it starts listening, to catch up', async () => {
    await renderStartedRun();

    await waitFor(() => {
      expect(vi.mocked(fetchLighthouseRun).mock.calls).toStrictEqual([[RUN_ID]]);
    });
  });

  it('reads the run again when a step of it ran and settles once it completes', async () => {
    const { result } = await renderStartedRun();
    await waitForJobReads(fetchLighthouseRun, 1);
    vi.mocked(fetchLighthouseRun).mockResolvedValue(buildRun());

    expect(await waitForDoneAfterSeoJobChanged('lighthouse', RUN_ID, () => result.current.state.status)).toBe(0);
  });

  it('ignores the steps of other runs', async () => {
    await renderStartedRun();
    await waitForJobReads(fetchLighthouseRun, 1);

    await emitSeoJobChanged('lighthouse', 'another-run');

    expect(fetchLighthouseRun).toHaveBeenCalledTimes(1);
  });

  it('starts once and never retries a refused start', async () => {
    vi.mocked(startLighthouse).mockRejectedValue(new RefusedError('refused'));
    const { result } = await renderStartedRun();

    expect([result.current.state, vi.mocked(startLighthouse).mock.calls.length, liveSubscriberCount('seo')]).toStrictEqual([{
      status: 'error',
      message: 'refused'
    }, 1, 0]);
  });

  it('stops listening when the hook unmounts', async () => {
    const { unmount } = await renderStartedRun();
    unmount();

    expect(liveSubscriberCount('seo')).toBe(0);
  });
});
