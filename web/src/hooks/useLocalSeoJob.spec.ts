import {
  act, waitFor
} from '@testing-library/react';
import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  fetchLocalJob, startLocalJob
} from '../api/seoLocal';
import {
  buildGridJob, buildStartJobResponse
} from '../api/seoLocal-fixtures';
import { renderStartedJob } from './useLocalSeoJob-fixtures';
import { liveSubscriberCount } from '../test/liveEventsMock';
import {
  emitSeoJobChanged, waitForDoneAfterSeoJobChanged, waitForJobReads
} from '../test/seoJobEvents';

vi.mock('../api/seoLocal');
vi.mock('../api/seo', () => import('../test/seoApiMock'));

const COLLECTING = buildGridJob('collecting', null);

beforeEach(() => {
  vi.mocked(startLocalJob).mockResolvedValue(buildStartJobResponse(COLLECTING));
  vi.mocked(fetchLocalJob).mockResolvedValue(COLLECTING);
});

describe('useLocalSeoJob', () => {
  it('reads the free status route once when it starts listening, to catch up', async () => {
    await renderStartedJob();

    await waitFor(() => {
      expect(fetchLocalJob).toHaveBeenCalledExactlyOnceWith(COLLECTING.job_id);
    });
  });

  it('reads it again when a step of the job ran, until the job completes', async () => {
    const { result } = await renderStartedJob();
    await waitForJobReads(fetchLocalJob, 1);
    vi.mocked(fetchLocalJob).mockResolvedValue(buildGridJob());

    expect(await waitForDoneAfterSeoJobChanged('local', COLLECTING.job_id, () => result.current.state.status)).toBe(0);
  });

  it('ignores the steps of other jobs', async () => {
    await renderStartedJob();
    await waitForJobReads(fetchLocalJob, 1);

    await emitSeoJobChanged('local', 'another-job');

    expect(fetchLocalJob).toHaveBeenCalledTimes(1);
  });

  it('stops listening on reset', async () => {
    const { result } = await renderStartedJob();
    act(() => { result.current.reset(); });

    expect(liveSubscriberCount('seo')).toBe(0);
  });

  it('stops listening when the hook unmounts', async () => {
    const { unmount } = await renderStartedJob();
    unmount();

    expect(liveSubscriberCount('seo')).toBe(0);
  });

  it('shows the error message when the start fails', async () => {
    vi.mocked(startLocalJob).mockRejectedValue(new TypeError('boom'));

    const { result } = await renderStartedJob();

    expect(result.current.state).toStrictEqual({
      status: 'error',
      message: 'boom'
    });
  });
});
