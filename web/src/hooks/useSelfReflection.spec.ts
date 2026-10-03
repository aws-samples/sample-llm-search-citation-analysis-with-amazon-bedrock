import {
  describe, it, expect, vi
} from 'vitest';
import {
  act, renderHook
} from '@testing-library/react';
import { useSelfReflection } from './useSelfReflection';
import {
  buildReflectionList, mockSelfReflection
} from './useSelfReflection-fixtures';
import { describeEndpointHookContract } from '../test/endpointHookContract';
import { createMockJsonResponse } from '../test/fetchResponses';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

import { mockAuthenticatedFetch } from '../test/infrastructureMock';

type TriggerReflectionArgs = Parameters<ReturnType<typeof useSelfReflection>['triggerReflection']>;

const anySignal: unknown = expect.any(AbortSignal);

describe('useSelfReflection', () => {
  it('starts with no data, not loading, and no error', () => {
    const { result } = renderHook(() => useSelfReflection());

    expect(result.current).toStrictEqual({
      data: null,
      loading: false,
      error: null,
      triggerReflection: expect.any(Function),
      fetchReflections: expect.any(Function),
    });
  });

  describeEndpointHookContract({
    subject: 'self-reflection',
    useHook: useSelfReflection,
    fetchName: 'triggerReflection',
    fetch: (hook, ...args: TriggerReflectionArgs) => hook.triggerReflection(...args),
    otherFunctions: ['fetchReflections'],
    defaultResponse: mockSelfReflection,
    defaultArgs: ['hotels in madrid', 'Hotel Sol', 'prompt-family'],
    expectedRequest: (url) => {
      const postInit: unknown = expect.objectContaining({
        method: 'POST',
        signal: anySignal,
      });
      return [url, postInit];
    },
    requests: [
      ['https://api.test.com/self-reflection', 'a reflection is triggered', ['hotels in madrid', 'Hotel Sol', 'prompt-family']],
    ],
    successes: [
      ['reflection', mockSelfReflection, ['hotels in madrid', 'Hotel Sol', 'prompt-family']],
    ],
    failures: [
      ['Unable to connect to the server', 'request returns a non-ok status', { shouldFail: true }],
      ['An unexpected error occurred', 'response is a backend {error} body', { errorResponse: { error: 'Analysis service unavailable' } }],
      ['Invalid request', 'payload fails the type guard', { invalidResponse: true }],
      ['Invalid request', 'payload is null', { nullResponse: true }],
    ],
    loggedHttpError: {
      logMessage: '[self-reflection] Error triggering reflection:',
      name: 'SelfReflectionFetchError',
      message: 'Failed to fetch self-reflection data',
    },
  });

  it.each([
    ['forces a refresh when asked', true, true],
    ['reuses a stored reflection by default', undefined, false],
  ])('posts the keyword, brand and persona and %s', async (_condition, forceRefresh, sentForceRefresh) => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(mockSelfReflection));
    const { result } = renderHook(() => useSelfReflection());

    await act(() => result.current.triggerReflection('hotels in madrid', 'Hotel Sol', 'prompt-family', forceRefresh));

    expect(mockAuthenticatedFetch).toHaveBeenCalledWith('https://api.test.com/self-reflection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        keyword: 'hotels in madrid',
        brand: 'Hotel Sol',
        query_prompt_id: 'prompt-family',
        force_refresh: sentForceRefresh,
      }),
      signal: anySignal,
    });
  });

  describe('fetchReflections', () => {
    it.each([
      ['https://api.test.com/self-reflection?keyword=hotels+in+madrid', 'only a keyword is given', [] as const],
      ['https://api.test.com/self-reflection?keyword=hotels+in+madrid&brand=Hotel+Sol&query_prompt_id=prompt-family', 'a brand and persona are given', ['Hotel Sol', 'prompt-family'] as const],
    ])('requests %s when %s', async (url, _condition, filters) => {
      mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildReflectionList([])));
      const { result } = renderHook(() => useSelfReflection());

      await act(() => result.current.fetchReflections('hotels in madrid', ...filters));

      expect(mockAuthenticatedFetch).toHaveBeenCalledWith(url, { signal: anySignal });
    });

    it('returns the stored reflections of the list response', async () => {
      mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(buildReflectionList([mockSelfReflection])));
      const { result } = renderHook(() => useSelfReflection());

      const reflections = await act(() => result.current.fetchReflections('hotels in madrid'));

      expect(reflections).toStrictEqual([mockSelfReflection]);
    });

    it('returns no reflections and logs the list failure when the response has no results array', async () => {
      const consoleError = vi.spyOn(console, 'error').mockImplementation(vi.fn());
      mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({ results: 'none' }));
      const { result } = renderHook(() => useSelfReflection());

      const reflections = await act(() => result.current.fetchReflections('hotels in madrid'));

      expect(reflections).toStrictEqual([]);
      expect(consoleError).toHaveBeenCalledWith('[self-reflection] Error fetching reflections:', expect.objectContaining({
        name: 'SelfReflectionFetchError',
        message: 'Invalid response format',
      }));
    });
  });
});
