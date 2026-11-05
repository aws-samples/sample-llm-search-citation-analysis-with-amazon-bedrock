import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { createMockJsonResponse } from '../test/fetchResponses';
import {
  apiDelete, apiGet, apiPost, apiPut, GET_RETRY_DELAY_MAX_MS, GET_RETRY_DELAY_MIN_MS, validateApiConfig
} from './client';

vi.mock('../infrastructure', () => import('../test/infrastructureMock'));

const requestBodyFixture = { keyword: 'alpha' };

interface ApiMethodCase {
  method: string;
  request: () => Promise<unknown>;
  requestWithStructured4xx: () => Promise<unknown>;
}

const apiMethodCases = [
  {
    method: 'GET',
    request: () => apiGet<unknown>('/test'),
    requestWithStructured4xx: () => apiGet<unknown>(
      '/test',
      { allowStructured4xx: true }
    ),
  },
  {
    method: 'POST',
    request: () => apiPost<unknown>('/test', requestBodyFixture),
    requestWithStructured4xx: () => apiPost<unknown>(
      '/test',
      requestBodyFixture,
      { allowStructured4xx: true }
    ),
  },
  {
    method: 'PUT',
    request: () => apiPut<unknown>('/test', requestBodyFixture),
    requestWithStructured4xx: () => apiPut<unknown>(
      '/test',
      requestBodyFixture,
      { allowStructured4xx: true }
    ),
  },
  {
    method: 'DELETE',
    request: () => apiDelete<unknown>('/test'),
    requestWithStructured4xx: () => apiDelete<unknown>(
      '/test',
      { allowStructured4xx: true }
    ),
  },
] satisfies ApiMethodCase[];

describe('API response errors', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it.each(apiMethodCases)(
    'uses only the HTTP fallback when $method receives a Cognito-like 400 without opt-in',
    async ({ request }) => {
      const response = createMockJsonResponse({
        error: 'NotAuthorizedException: Incorrect username or password',
        field: 'cognito.authentication',
      }, 400, 'Bad Request');
      mockAuthenticatedFetch.mockResolvedValue(response);

      await expect(request()).rejects.toMatchObject({
        name: 'ApiRequestError',
        message: 'HTTP 400: Bad Request',
        statusCode: 400,
        responseMessage: undefined,
        field: undefined,
        category: 'validation',
      });
      expect(response.bodyUsed).toBe(false);
    }
  );

  it.each(apiMethodCases)(
    'throws trusted structured details when $method opts into a 4xx response',
    async ({ requestWithStructured4xx }) => {
      mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({
        error: 'Keyword is invalid',
        field: 'keywords[0].keyword',
      }, 400, 'Bad Request'));

      await expect(requestWithStructured4xx()).rejects.toMatchObject({
        name: 'ApiRequestError',
        message: 'Keyword is invalid',
        statusCode: 400,
        responseMessage: 'Keyword is invalid',
        field: 'keywords[0].keyword',
        category: 'validation',
      });
    }
  );

  it.each(apiMethodCases)(
    'uses only the HTTP fallback when opted-in $method receives sensitive JSON in a 503 response',
    async ({ requestWithStructured4xx }) => {
      const response = createMockJsonResponse({
        error: 'Database credentials exposed: secret-value',
        field: 'internal.database.credentials',
      }, 503, 'Service Unavailable');
      mockAuthenticatedFetch.mockResolvedValue(response);

      await expect(requestWithStructured4xx()).rejects.toMatchObject({
        name: 'ApiRequestError',
        message: 'HTTP 503: Service Unavailable',
        statusCode: 503,
        responseMessage: undefined,
        field: undefined,
        category: 'server',
      });
      expect(response.bodyUsed).toBe(false);
    }
  );

  it('returns JSON when POST explicitly accepts a 503 domain response', async () => {
    const responseBody = {
      success: false,
      error: 'Could not start content generation. Please try again.',
    };
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(
      responseBody,
      503,
      'Service Unavailable'
    ));

    await expect(apiPost<unknown>(
      '/test',
      requestBodyFixture,
      { acceptedJsonStatuses: [503] }
    )).resolves.toStrictEqual(responseBody);
  });

  it.each([
    {
      name: 'stores no field when an opted-in structured response omits it',
      response: () => createMockJsonResponse(
        { error: 'Keyword conflicts with an active keyword' },
        409,
        'Conflict'
      ),
      request: () => apiPost<unknown>('/test', requestBodyFixture, { allowStructured4xx: true }),
      expected: {
        message: 'Keyword conflicts with an active keyword',
        statusCode: 409,
        responseMessage: 'Keyword conflicts with an active keyword',
      },
    },
    {
      name: 'uses the HTTP fallback when an opted-in 4xx JSON error shape is invalid',
      response: () => createMockJsonResponse({
        error: 'Keyword is invalid',
        field: 0,
      }, 400, 'Bad Request'),
      request: () => apiPost<unknown>('/test', requestBodyFixture, { allowStructured4xx: true }),
      expected: {
        message: 'HTTP 400: Bad Request',
        statusCode: 400,
        responseMessage: undefined,
      },
    },
    {
      name: 'uses the HTTP fallback when an opted-in 4xx response body is not JSON',
      response: () => new Response('<html>Bad request</html>', {
        status: 400,
        statusText: 'Bad Request',
        headers: { 'Content-Type': 'text/html' },
      }),
      request: () => apiGet<unknown>('/test', { allowStructured4xx: true }),
      expected: {
        message: 'HTTP 400: Bad Request',
        statusCode: 400,
        responseMessage: undefined,
      },
    },
  ])('$name', async ({
    response, request, expected 
  }) => {
    mockAuthenticatedFetch.mockResolvedValue(response());

    await expect(request()).rejects.toMatchObject({
      ...expected,
      field: undefined 
    });
  });
});

describe('validateApiConfig', () => {
  it('does not throw when API_BASE_URL is valid', () => {
    expect(() => validateApiConfig()).not.toThrow();
  });
});

const recoveredBody = { searches: ['recovered'] };

/** Pins the retry jitter: every `crypto.getRandomValues` call fills its array with `draw`. */
function stubRandomDraw(draw: number): void {
  vi.spyOn(crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint16Array) array.fill(draw);
    return array;
  });
}

describe('apiGet transient-failure retry', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stubRandomDraw(0);
    mockAuthenticatedFetch.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it.each([
    {
      failure: '502',
      first: async () => createMockJsonResponse({}, 502, 'Bad Gateway'),
    },
    {
      failure: '503',
      first: async () => createMockJsonResponse({}, 503, 'Service Unavailable'),
    },
    {
      failure: '429',
      first: async () => createMockJsonResponse({}, 429, 'Too Many Requests'),
    },
    {
      failure: 'a network TypeError',
      first: async (): Promise<Response> => Promise.reject(new TypeError('Failed to fetch')),
    },
  ])('returns the second answer when the first GET fails with $failure', async ({ first }) => {
    mockAuthenticatedFetch.mockImplementationOnce(first).mockResolvedValueOnce(createMockJsonResponse(recoveredBody));

    const pending = apiGet<unknown>('/searches');
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MIN_MS);

    await expect(pending).resolves.toStrictEqual(recoveredBody);
  });

  it.each([
    {
      name: 'a GET times out with 504',
      status: 504,
      request: () => apiGet<unknown>('/citations'),
    },
    {
      name: 'a GET answers 500',
      status: 500,
      request: () => apiGet<unknown>('/stats'),
    },
    {
      name: 'a GET answers 404',
      status: 404,
      request: () => apiGet<unknown>('/stats'),
    },
    {
      name: 'a GET with the retry turned off answers 503',
      status: 503,
      request: () => apiGet<unknown>('/content-studio/status/a', { retry: false }),
    },
    {
      name: 'a POST answers 503',
      status: 503,
      request: () => apiPost<unknown>('/trigger', {}),
    },
  ])('sends one request and fails at once when $name', async ({
    status, request
  }) => {
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, status, 'Failed'));

    await expect(request()).rejects.toMatchObject({ statusCode: status });
    expect(mockAuthenticatedFetch).toHaveBeenCalledTimes(1);
  });

  it('rejects with the retry error when the retried GET fails again', async () => {
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({}, 503, 'Service Unavailable'))
      .mockResolvedValueOnce(createMockJsonResponse({}, 502, 'Bad Gateway'));

    const outcome = expect(apiGet<unknown>('/stats')).rejects.toMatchObject({ statusCode: 502 });
    await vi.advanceTimersByTimeAsync(GET_RETRY_DELAY_MIN_MS);

    await outcome;
  });

  it.each([
    {
      draw: 0,
      delay: GET_RETRY_DELAY_MIN_MS,
    },
    {
      draw: 0xFFFF,
      delay: GET_RETRY_DELAY_MAX_MS,
    },
  ])('sends the retry $delay ms after the failure when the jitter draws $draw', async ({
    draw, delay
  }) => {
    stubRandomDraw(draw);
    mockAuthenticatedFetch
      .mockResolvedValueOnce(createMockJsonResponse({}, 429, 'Too Many Requests'))
      .mockResolvedValueOnce(createMockJsonResponse(recoveredBody));

    const pending = apiGet<unknown>('/stats');
    await vi.advanceTimersByTimeAsync(delay - 1);
    const callsBeforeDelay = mockAuthenticatedFetch.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1);
    await pending;

    expect([callsBeforeDelay, mockAuthenticatedFetch.mock.calls.length]).toStrictEqual([1, 2]);
  });

  it('rejects with AbortError and sends no retry when the caller aborts during the wait', async () => {
    const controller = new AbortController();
    mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse({}, 503, 'Service Unavailable'));

    const outcome = expect(apiGet<unknown>('/stats', { signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
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
});

describe('validateApiConfig with placeholder', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('throws ApiConfigError when API_BASE_URL contains PLACEHOLDER', async () => {
    vi.doMock('../infrastructure', async () => {
      const actual = await vi.importActual<typeof import('../infrastructure')>('../infrastructure');
      return {
        ...actual,
        API_BASE_URL: 'PLACEHOLDER_URL',
      };
    });

    const { validateApiConfig: validate } = await import('./client');

    expect(() => validate()).toThrow('API URL not configured');
  });
});
