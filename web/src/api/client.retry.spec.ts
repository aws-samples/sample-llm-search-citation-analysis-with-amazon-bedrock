import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import {
  apiGet, apiPost, GET_RETRY_DELAY_MAX_MS, GET_RETRY_DELAY_MIN_MS
} from './client';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const recoveredBody = { searches: ['recovered'] };

/** Pins the retry jitter: every `crypto.getRandomValues` call fills its array with `draw`. */
function stubRandomDraw(draw: number): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array) array.fill(draw);
    return array;
  });
}

describe('apiGet retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubRandomDraw(0);
    mockAuthenticatedFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([502, 503, 429])('returns the second answer when the first GET fails with %i', async (status) => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({ message: 'blip' }, status, 'Blip'))
      .mockResolvedValueOnce(createMockJsonResponse(recoveredBody));

    const pending = apiGet<unknown>('/searches');
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MIN_MS);

    await expect(pending).resolves.toStrictEqual(recoveredBody);
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('returns the second answer when the first GET fails with a network TypeError', async () => {
    mockAuthenticatedFetch
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(createMockJsonResponse(recoveredBody));

    const pending = apiGet<unknown>('/searches');
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MIN_MS);

    await expect(pending).resolves.toStrictEqual(recoveredBody);
  });

  it('fails at once without a second request when the GET times out with 504', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({ message: 'Endpoint request timed out' }, 504, 'Gateway Timeout'));

    await expect(apiGet<unknown>('/citations')).rejects.toMatchObject({
      statusCode: 504,
      category: 'timeout',
    });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it.each([400, 403, 404, 500])('fails at once without a second request when the GET answers %i', async (status) => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({ error: 'no' }, status, 'No'));

    await expect(apiGet<unknown>('/stats')).rejects.toMatchObject({ statusCode: status });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects with the retry error when the retried GET fails again', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({}, 503, 'Service Unavailable'))
      .mockResolvedValueOnce(createMockJsonResponse({}, 502, 'Bad Gateway'));

    const pending = apiGet<unknown>('/stats');
    const outcome = expect(pending).rejects.toMatchObject({ statusCode: 502 });
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MIN_MS);

    await outcome;
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(2);
  });

  it('waits the minimum delay before the retry when the jitter draws its smallest value', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({}, 503, 'Service Unavailable'))
      .mockResolvedValueOnce(createMockJsonResponse(recoveredBody));

    const pending = apiGet<unknown>('/stats');
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MIN_MS - 1);
    const callsBeforeDelay = mockAuthenticatedFetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect([callsBeforeDelay, mockAuthenticatedFetch.mock.calls.length]).toStrictEqual([1, 2]);
  });

  it('waits the maximum delay before the retry when the jitter draws its largest value', async () => {
    stubRandomDraw(0xFFFF_FFFF);
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({}, 429, 'Too Many Requests'))
      .mockResolvedValueOnce(createMockJsonResponse(recoveredBody));

    const pending = apiGet<unknown>('/stats');
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MAX_MS - 1);
    const callsBeforeDelay = mockAuthenticatedFetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect([callsBeforeDelay, mockAuthenticatedFetch.mock.calls.length]).toStrictEqual([1, 2]);
  });

  it('rejects with AbortError and sends no retry when the caller aborts during the wait', async () => {
    const controller = new AbortController();
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 503, 'Service Unavailable'));

    const pending = apiGet<unknown>('/stats', { signal: controller.signal });
    const outcome = expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MIN_MS - 100);
    controller.abort();
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MAX_MS);

    await outcome;
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('rethrows the first error without a retry when the signal is already aborted', async () => {
    const controller = new AbortController();
    mockAuthenticatedFetch.mockImplementation(async () => {
      controller.abort();
      return createMockJsonResponse({}, 502, 'Bad Gateway');
    });

    await expect(apiGet<unknown>('/stats', { signal: controller.signal })).rejects.toMatchObject({ statusCode: 502 });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('fails at once on 503 when the caller turns the retry off', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 503, 'Service Unavailable'));

    await expect(apiGet<unknown>('/content-studio/status/a', { retry: false })).rejects.toMatchObject({ statusCode: 503 });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('sends a POST once when it fails with 503', async () => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 503, 'Service Unavailable'));

    await expect(apiPost<unknown>('/trigger', {})).rejects.toMatchObject({ statusCode: 503 });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });
});
