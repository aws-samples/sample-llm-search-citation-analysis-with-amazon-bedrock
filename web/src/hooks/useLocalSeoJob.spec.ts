import { act } from '@testing-library/react';
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
import { JOB_POLL_INTERVAL_MS } from './useLocalSeoJob';
import {
  advanceFakeTime, runEachTestWithFakeTimers
} from '../test/fakeTime';
import { countClearTimeoutsOnUnmount } from '../test/clearTimeoutOnUnmount';

vi.mock('../api/seoLocal');
vi.mock('../api/seo', () => import('../test/seoApiMock'));

runEachTestWithFakeTimers();

beforeEach(() => {
  vi.mocked(startLocalJob).mockResolvedValue(buildStartJobResponse(buildGridJob('collecting', null)));
  vi.mocked(fetchLocalJob).mockResolvedValue(buildGridJob());
});

describe('useLocalSeoJob', () => {
  it('polls the free status route until the job completes', async () => {
    const { result } = await renderStartedJob();

    await advanceFakeTime(JOB_POLL_INTERVAL_MS);

    expect(result.current.state.status).toBe('done');
  });

  it('runs no status call before the poll interval has passed', async () => {
    await renderStartedJob();

    expect(fetchLocalJob).not.toHaveBeenCalledWith(expect.anything());
  });

  it('stops polling on reset', async () => {
    const { result } = await renderStartedJob();
    act(() => { result.current.reset(); });

    await advanceFakeTime(3 * JOB_POLL_INTERVAL_MS);

    expect(vi.mocked(fetchLocalJob).mock.calls).toStrictEqual([]);
  });

  it('calls clearTimeout once when the hook unmounts with a poll pending', async () => {
    await expect(countClearTimeoutsOnUnmount(renderStartedJob)).resolves.toBe(1);
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
