import {
  describe, expect, it, vi
} from 'vitest';
import { fixtureBody } from '../types/domain/scopeCoverage-fixtures';
import { setupFakeTimersAndFetch } from '../test/scopedTestKit';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import {
  emitLive, liveSubscriberCount, reconnectLive
} from '../test/liveEventsMock';
import { readsAndListeners } from '../test/liveReadCounts';
import { apiGet } from './client';
import { VIEW_JOB_WAIT_LIMIT_MS } from './viewJobs';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const computingBody = fixtureBody('visibility', 'computing');
const completeBody = fixtureBody('visibility', 'complete');
const failedBody = fixtureBody('visibility', 'failed');
const JOB_ID = String(Reflect.get(Object(Reflect.get(Object(computingBody), 'job')), 'id'));
const FINISHED = {
  type: 'view-job.finished',
  job_id: JOB_ID,
  status: 'done' 
};

/** `authenticatedFetch` answers 202 computing `computingAnswers` times, then the complete body. */
function mockComputingThenComplete(computingAnswers: number): void {
  Array.from({ length: computingAnswers }).forEach(() => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(computingBody, 202));
  });
  mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(completeBody));
}

/** Starts `GET /visibility` over two computing answers then the complete body, and lets `ms` of fake time pass. */
async function setupComputingVisibility(ms: number): Promise<{ readonly request: Promise<unknown> }> {
  mockComputingThenComplete(2);
  const request = apiGet<unknown>('/visibility');
  await vi.advanceTimersByTimeAsync(ms);
  return { request };
}

/** `authenticatedFetch` answers 202 computing forever. */
function mockAlwaysComputing(): void {
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse(computingBody, 202)));
}

describe('apiGet on a 202 computing answer', () => {
  setupFakeTimersAndFetch();

  it('reads once more when it starts listening, which catches a job that finished before it listened', async () => {
    mockComputingThenComplete(1);

    await expect(apiGet<unknown>('/visibility')).resolves.toStrictEqual(completeBody);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('reads again only when the job’s finished event arrives, not on a timer', async () => {
    const { request } = await setupComputingVisibility(VIEW_JOB_WAIT_LIMIT_MS - 1);
    const callsBeforeEvent = mockAuthenticatedFetch.mock.calls.length;
    await emitLive('view-jobs', FINISHED);

    await expect(request).resolves.toStrictEqual(completeBody);
    expect([callsBeforeEvent, mockAuthenticatedFetch.mock.calls.length]).toStrictEqual([2, 3]);
  });

  it('ignores the events of other jobs', async () => {
    mockComputingThenComplete(2);

    const settled = apiGet<unknown>('/visibility').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(0);
    await emitLive('view-jobs', {
      ...FINISHED,
      job_id: 'job-other' 
    });

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(VIEW_JOB_WAIT_LIMIT_MS);
    await settled;
  });

  it('reads again after a reconnect, to catch up on what it missed', async () => {
    const { request } = await setupComputingVisibility(0);
    await reconnectLive('view-jobs');

    await expect(request).resolves.toStrictEqual(completeBody);
  });

  it('reports every 202 to onComputing with the job body', async () => {
    const onComputing = vi.fn();
    mockComputingThenComplete(2);

    const request = apiGet<unknown>('/visibility', { onComputing });
    await vi.advanceTimersByTimeAsync(0);
    await emitLive('view-jobs', FINISHED);
    await request;

    expect(onComputing.mock.calls).toStrictEqual([[computingBody], [computingBody]]);
  });

  it('answers the complete body from the read at 3 minutes when no event told it the job finished', async () => {
    const { request } = await setupComputingVisibility(VIEW_JOB_WAIT_LIMIT_MS);

    await expect(request).resolves.toStrictEqual(completeBody);
  });

  it('rejects with a 504 ApiRequestError when the read at 3 minutes still finds the job computing, and stops listening', async () => {
    mockAlwaysComputing();

    const outcome = expect(apiGet<unknown>('/visibility')).rejects.toMatchObject({
      name: 'ApiRequestError',
      statusCode: 504,
    });
    await vi.advanceTimersByTimeAsync(VIEW_JOB_WAIT_LIMIT_MS);

    await outcome;
    expect(readsAndListeners('view-jobs')).toStrictEqual([3, 0]);
  });

  it('rejects with AbortError, stops listening and sends no further request when the caller aborts during the wait', async () => {
    const controller = new AbortController();
    mockAlwaysComputing();

    const outcome = expect(apiGet<unknown>('/visibility', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await outcome;
    await emitLive('view-jobs', FINISHED);

    expect(readsAndListeners('view-jobs')).toStrictEqual([2, 0]);
  });

  it('rejects with a 500 ApiRequestError carrying the message when the job failed', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(failedBody));

    await expect(apiGet<unknown>('/visibility')).rejects.toMatchObject({
      name: 'ApiRequestError',
      statusCode: 500,
      message: `The view job failed: ${String(Reflect.get(Object(failedBody), 'message'))}`,
    });
  });

  it('rejects with the failure when the job fails while it waits', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(computingBody, 202))
      .mockResolvedValue(createMockJsonResponse(failedBody));

    await expect(apiGet<unknown>('/visibility')).rejects.toMatchObject({ statusCode: 500 });
    expect(liveSubscriberCount('view-jobs')).toBe(0);
  });

  it('returns a 202 body that is not a computing answer as it is, without listening', async () => {
    const accepted = {
      status: 'queued',
      id: 'research-1',
    };
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(accepted, 202));

    await expect(apiGet<unknown>('/keyword-research/research-1')).resolves.toStrictEqual(accepted);
    expect(liveSubscriberCount('view-jobs')).toBe(0);
  });
});
