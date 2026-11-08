import {
  describe, expect, it, vi
} from 'vitest';
import { fixtureBody } from '../types/domain/scopeCoverage-fixtures';
import { setupFakeTimersAndFetch } from '../test/scopedTestKit';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { apiGet } from './client';
import {
  COMPUTING_POLL_LIMIT_MS, computingPollDelayMs
} from './viewJobs';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const computingBody = fixtureBody('visibility', 'computing');
const completeBody = fixtureBody('visibility', 'complete');
const failedBody = fixtureBody('visibility', 'failed');

/** `authenticatedFetch` answers 202 computing `computingAnswers` times, then the complete body. */
function mockComputingThenComplete(computingAnswers: number): void {
  Array.from({ length: computingAnswers }).forEach(() => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(computingBody, 202));
  });
  mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(completeBody));
}

/** `authenticatedFetch` answers 202 computing forever. */
function mockAlwaysComputing(): void {
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse(computingBody, 202)));
}

describe('computingPollDelayMs', () => {
  it.each([
    [0, 2_000],
    [1, 4_000],
    [2, 8_000],
    [3, 10_000],
    [40, 10_000],
  ])('waits the backoff of attempt %i (%i ms) when the server hints less', (attempt, expected) => {
    expect(computingPollDelayMs(attempt, 500)).toBe(expected);
  });

  it('waits the server hint when it is longer than the backoff', () => {
    expect(computingPollDelayMs(0, 6_000)).toBe(6_000);
  });

  it('never waits longer than 10 s even when the server hints more', () => {
    expect(computingPollDelayMs(0, 60_000)).toBe(10_000);
  });
});

describe('apiGet on a 202 computing answer', () => {
  setupFakeTimersAndFetch();

  it('resolves the 200 body that follows the 202 answers', async () => {
    mockComputingThenComplete(2);

    const request = apiGet<unknown>('/visibility');
    await vi.advanceTimersByTimeAsync(2_000 + 4_000);

    await expect(request).resolves.toStrictEqual(completeBody);
  });

  it('sends the next poll only after the 2 s backoff has passed', async () => {
    mockComputingThenComplete(1);

    const request = apiGet<unknown>('/visibility');
    await vi.advanceTimersByTimeAsync(1_999);
    const callsBeforeBackoff = mockAuthenticatedFetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    await request;
    const callsAfterBackoff = mockAuthenticatedFetch.mock.calls.length;

    expect([callsBeforeBackoff, callsAfterBackoff]).toStrictEqual([1, 2]);
  });

  it('reports every 202 to onComputing with the job body', async () => {
    const onComputing = vi.fn();
    mockComputingThenComplete(1);

    const request = apiGet<unknown>('/visibility', { onComputing });
    await vi.advanceTimersByTimeAsync(2_000);
    await request;

    expect(onComputing.mock.calls).toStrictEqual([[computingBody]]);
  });

  it('rejects with a 504 ApiRequestError when the job is still computing after 3 minutes', async () => {
    mockAlwaysComputing();

    const outcome = expect(apiGet<unknown>('/visibility')).rejects.toMatchObject({
      name: 'ApiRequestError',
      statusCode: 504,
    });
    await vi.advanceTimersByTimeAsync(COMPUTING_POLL_LIMIT_MS);

    await outcome;
  });

  it('sends at most 21 requests in the 3 minutes it waits for a job', async () => {
    mockAlwaysComputing();

    const settled = apiGet<unknown>('/visibility').catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(COMPUTING_POLL_LIMIT_MS);
    await settled;

    // 2 + 4 + 8 s, then one poll every 10 s: 4 + 16 polls fit in 180 s, plus the first GET.
    expect(mockAuthenticatedFetch.mock.calls.length).toBeLessThanOrEqual(21);
  });

  it('rejects with AbortError and sends no further poll when the caller aborts during the wait', async () => {
    const controller = new AbortController();
    mockAlwaysComputing();

    const outcome = expect(apiGet<unknown>('/visibility', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(500);
    controller.abort();
    await outcome;
    await vi.advanceTimersByTimeAsync(10_000);

    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects with a 500 ApiRequestError carrying the message when the job failed', async () => {
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(failedBody));

    await expect(apiGet<unknown>('/visibility')).rejects.toMatchObject({
      name: 'ApiRequestError',
      statusCode: 500,
      message: `The view job failed: ${String(Reflect.get(Object(failedBody), 'message'))}`,
    });
  });

  it('returns a 202 body that is not a computing answer as it is', async () => {
    const accepted = {
      status: 'queued',
      id: 'research-1',
    };
    mockAuthenticatedFetch.mockResolvedValueOnce(createMockJsonResponse(accepted, 202));

    await expect(apiGet<unknown>('/keyword-research/research-1')).resolves.toStrictEqual(accepted);
  });
});
