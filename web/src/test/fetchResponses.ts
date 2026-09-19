/**
 * Builders for the `Response` objects specs feed to the mocked
 * `authenticatedFetch` (see ./infrastructureMock).
 *
 * Real `Response` instances, not `{ ok, json }` look-alikes: `ok` follows the
 * status code, `json()` parses the serialised payload, and the value satisfies
 * `authenticatedFetch`'s return type without casts.
 */
import { vi } from 'vitest';
import type { authenticatedFetch } from '../infrastructure/auth';

export function createMockJsonResponse(responsePayload: unknown, responseStatus = 200): Response {
  return new Response(JSON.stringify(responsePayload), {
    status: responseStatus,
    statusText: responseStatus === 200 ? 'OK' : 'Request failed',
    headers: { 'Content-Type': 'application/json' },
  });
}

/** A response whose body is not JSON, so `response.json()` rejects. */
export function createMockMalformedResponse(responseStatus = 200): Response {
  return new Response('not json', { status: responseStatus });
}

export interface DeferredResponse {
  promise: Promise<Response>;
  resolve: (response: Response) => void;
  reject: (reason: unknown) => void;
}

/**
 * A fetch result the test settles by hand — for asserting on the in-flight
 * (`loading === true`) state before resolving with `createMockJsonResponse`.
 */
export function createDeferredResponse(): DeferredResponse {
  // The Promise executor runs synchronously, so both settlers are real by
  // the time they are spread into the result.
  const settlers: Pick<DeferredResponse, 'resolve' | 'reject'> = {
    resolve: () => undefined,
    reject: () => undefined,
  };
  const promise = new Promise<Response>((resolve, reject) => {
    settlers.resolve = resolve;
    settlers.reject = reject;
  });
  return {
    promise,
    ...settlers 
  };
}

export interface EndpointMockFetchOptions<TResponse> {
  /** Payload for the success path; defaults to the fixture the hook is built around. */
  response?: TResponse;
  /** Resolve with a non-OK status instead of a payload. */
  shouldFail?: boolean;
  /** Status used when `shouldFail` is set (500 by default). */
  failStatus?: number;
  /** Resolve OK with a backend `{ error }` body. */
  errorResponse?: { error: string };
  /** Resolve OK with a body that does not match the hook's type guard. */
  invalidResponse?: boolean;
}

/**
 * Mock `authenticatedFetch` for hooks that call a single endpoint: success,
 * HTTP failure, backend `{ error }` body, or a payload that fails the type
 * guard.
 */
export function createEndpointMockFetch<TResponse>(
  defaultResponse: TResponse,
  options: EndpointMockFetchOptions<TResponse> = {}
) {
  return vi.fn<typeof authenticatedFetch>().mockImplementation(() => {
    if (options.shouldFail) {
      return Promise.resolve(createMockJsonResponse({}, options.failStatus ?? 500));
    }
    if (options.errorResponse) {
      return Promise.resolve(createMockJsonResponse(options.errorResponse));
    }
    if (options.invalidResponse) {
      return Promise.resolve(createMockJsonResponse({ invalid: 'data' }));
    }
    return Promise.resolve(createMockJsonResponse(options.response ?? defaultResponse));
  });
}
