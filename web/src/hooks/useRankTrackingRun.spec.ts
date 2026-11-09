import {
  renderHook, waitFor
} from '@testing-library/react';
import {
  afterEach, describe, expect, it, vi
} from 'vitest';
import {
  fetchLatestRankRun, startRankRun
} from '../api/seoRankTracking';
import { buildRankRun } from '../api/seoRankTracking-fixtures';
import {
  emitLive, liveSubscriberCount, resetLiveEvents
} from '../test/liveEventsMock';
import { useRankTrackingRun } from './useRankTrackingRun';

vi.mock('../api/seoRankTracking');
vi.mock('../infrastructure/liveEvents', () => import('../test/liveEventsMock'));

const TRACKER = 'tracker-1';
const RUNNING = buildRankRun({ status: 'running' });
const DONE = buildRankRun({ status: 'completed' });

afterEach(() => {
  resetLiveEvents();
  vi.clearAllMocks();
});

function renderRun(initial = RUNNING, onFinished = vi.fn()) {
  return {
    onFinished,
    ...renderHook(() => useRankTrackingRun(TRACKER, initial, onFinished)) 
  };
}

describe('useRankTrackingRun', () => {
  it('listens to nothing while no run is active', () => {
    renderRun(DONE);

    expect(liveSubscriberCount('seo')).toBe(0);
    expect(fetchLatestRankRun).not.toHaveBeenCalled();
  });

  it('reads the latest run once when it starts listening, to catch up', async () => {
    vi.mocked(fetchLatestRankRun).mockResolvedValue(RUNNING);
    renderRun();

    await waitFor(() => {
      expect(fetchLatestRankRun).toHaveBeenCalledExactlyOnceWith(TRACKER);
    });
  });

  it('reads it again when a step of this tracker’s run ran, and calls onFinished once it ended', async () => {
    vi.mocked(fetchLatestRankRun).mockResolvedValueOnce(RUNNING).mockResolvedValue(DONE);
    const {
      result, onFinished 
    } = renderRun();
    await waitFor(() => {
      expect(fetchLatestRankRun).toHaveBeenCalledTimes(1);
    });
    await emitLive('seo', {
      type: 'seo-job.changed',
      feature: 'rank',
      id: TRACKER 
    });

    await waitFor(() => {
      expect(result.current.run).toStrictEqual(DONE);
    });
    expect(onFinished).toHaveBeenCalledTimes(1);
    expect(liveSubscriberCount('seo')).toBe(0);
  });

  it.each([
    ['another tracker', {
      feature: 'rank',
      id: 'tracker-2' 
    }],
    ['another SEO feature', {
      feature: 'audit',
      id: TRACKER 
    }],
  ])('ignores an event of %s', async (_case, fields) => {
    vi.mocked(fetchLatestRankRun).mockResolvedValue(RUNNING);
    renderRun();
    await waitFor(() => {
      expect(fetchLatestRankRun).toHaveBeenCalledTimes(1);
    });
    await emitLive('seo', {
      type: 'seo-job.changed',
      ...fields 
    });

    expect(fetchLatestRankRun).toHaveBeenCalledTimes(1);
  });

  it('shows the read error and keeps the run', async () => {
    vi.mocked(fetchLatestRankRun).mockRejectedValue(new TypeError('offline'));
    const { result } = renderRun();

    await waitFor(() => {
      expect(result.current.error).not.toBeNull();
    });
    expect(result.current.run).toStrictEqual(RUNNING);
  });

  it('starts a paid run only when asked and listens to it', async () => {
    vi.mocked(startRankRun).mockResolvedValue({ run: RUNNING });
    vi.mocked(fetchLatestRankRun).mockResolvedValue(RUNNING);
    const { result } = renderRun(DONE);
    await result.current.start();

    await waitFor(() => {
      expect(liveSubscriberCount('seo')).toBe(1);
    });
    expect(startRankRun).toHaveBeenCalledExactlyOnceWith(TRACKER);
  });
});
