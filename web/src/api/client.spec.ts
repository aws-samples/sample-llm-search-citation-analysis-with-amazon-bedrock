import {
  beforeEach, describe, expect, it, vi
} from 'vitest';
import { authenticatedFetch } from '../infrastructure';
import {
  apiDelete, apiGet, apiPatch, apiPost, apiPut, validateApiConfig
} from './client';

vi.mock('../infrastructure', async () => {
  const actual = await vi.importActual<typeof import('../infrastructure')>('../infrastructure');
  return {
    ...actual,
    API_BASE_URL: 'https://api.example.com',
    authenticatedFetch: vi.fn(),
  };
});

const mockAuthenticatedFetch = vi.mocked(authenticatedFetch);
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
  {
    method: 'PATCH',
    request: () => apiPatch<unknown>('/test', requestBodyFixture),
    requestWithStructured4xx: () => apiPatch<unknown>(
      '/test',
      requestBodyFixture,
      { allowStructured4xx: true }
    ),
  },
] satisfies ApiMethodCase[];

function jsonResponse(body: unknown, status: number, statusText: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('API response errors', () => {
  beforeEach(() => {
    mockAuthenticatedFetch.mockReset();
  });

  it.each(apiMethodCases)(
    'uses only the HTTP fallback when $method receives a Cognito-like 400 without opt-in',
    async ({ request }) => {
      const response = jsonResponse({
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
      mockAuthenticatedFetch.mockResolvedValue(jsonResponse({
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
      const response = jsonResponse({
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

  it('stores no field when an opted-in structured response omits it', async () => {
    mockAuthenticatedFetch.mockResolvedValue(jsonResponse(
      { error: 'Keyword conflicts with an active keyword' },
      409,
      'Conflict'
    ));

    await expect(apiPost<unknown>(
      '/test',
      requestBodyFixture,
      { allowStructured4xx: true }
    )).rejects.toMatchObject({
      message: 'Keyword conflicts with an active keyword',
      statusCode: 409,
      responseMessage: 'Keyword conflicts with an active keyword',
      field: undefined,
    });
  });

  it('uses the HTTP fallback when an opted-in 4xx JSON error shape is invalid', async () => {
    mockAuthenticatedFetch.mockResolvedValue(jsonResponse({
      error: 'Keyword is invalid',
      field: 0,
    }, 400, 'Bad Request'));

    await expect(apiPost<unknown>(
      '/test',
      requestBodyFixture,
      { allowStructured4xx: true }
    )).rejects.toMatchObject({
      message: 'HTTP 400: Bad Request',
      statusCode: 400,
      responseMessage: undefined,
      field: undefined,
    });
  });

  it('uses the HTTP fallback when an opted-in 4xx response body is not JSON', async () => {
    mockAuthenticatedFetch.mockResolvedValue(new Response('<html>Bad request</html>', {
      status: 400,
      statusText: 'Bad Request',
      headers: { 'Content-Type': 'text/html' },
    }));

    await expect(apiGet<unknown>(
      '/test',
      { allowStructured4xx: true }
    )).rejects.toMatchObject({
      message: 'HTTP 400: Bad Request',
      statusCode: 400,
      responseMessage: undefined,
      field: undefined,
    });
  });
});

describe('validateApiConfig', () => {
  it('does not throw when API_BASE_URL is valid', () => {
    expect(() => validateApiConfig()).not.toThrow();
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
