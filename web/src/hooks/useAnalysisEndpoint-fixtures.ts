import { vi } from 'vitest';
import {
  renderHook, act 
} from '@testing-library/react';
import type { authenticatedFetch } from '../infrastructure/auth';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { useAnalysisEndpoint } from './useAnalysisEndpoint';

export interface ProbeResponse {
  keyword: string;
  score: number;
}

export class ProbeRequestError extends Error {
  constructor(message = 'Failed to fetch probe results') {
    super(message);
    this.name = 'ProbeRequestError';
  }
}

function isProbeResponse(data: unknown): data is ProbeResponse {
  return typeof data === 'object' && data !== null && 'keyword' in data && 'score' in data;
}

export const probeResponse: ProbeResponse = {
  keyword: 'best hotels',
  score: 42,
};

export const newerProbeResponse: ProbeResponse = {
  keyword: 'luxury resorts',
  score: 87,
};

function buildProbeEndpoint() {
  return {
    errorContext: 'visibility',
    logMessage: '[probe] Error fetching probe results:',
    isValidResponse: isProbeResponse,
    createHttpError: (status: number) => new ProbeRequestError(`Failed to fetch probe results (${status})`),
    createResponseError: (message: string) => new ProbeRequestError(message),
    buildRequest: (keyword: string) => ({
      path: '/probe',
      params: new URLSearchParams({ keyword }),
    }),
  };
}

/**
 * Renders `useAnalysisEndpoint` against a fresh probe config. The config is
 * returned so tests can hand it to `runRequest` as the response contract.
 */
export function renderProbeEndpoint() {
  const config = buildProbeEndpoint();
  return {
    config,
    ...renderHook(() => useAnalysisEndpoint(config)),
  };
}

interface RecordedAnalysisRequest {
  signal: AbortSignal | undefined;
  /** Settle the request with `payload`, as a 200 unless a `status` is given. */
  respond: (payload: unknown, status?: number) => void;
}

/**
 * Mock fetch that never settles on its own: each call is recorded so
 * tests can resolve responses out of order and inspect abort signals.
 * With `rejectOnAbort` the pending promise rejects with an AbortError
 * when its signal aborts (real fetch behaviour); without it the mock
 * ignores the abort, simulating a stale response that still arrives.
 */
function createDeferredMockFetch(options: { rejectOnAbort?: boolean } = {}) {
  const requests: RecordedAnalysisRequest[] = [];
  const impl = vi.fn<typeof authenticatedFetch>().mockImplementation((_url, init) => {
    const signal = init?.signal ?? undefined;
    return new Promise<Response>((resolve, reject) => {
      if (options.rejectOnAbort) {
        // Reject with the signal's own reason, as fetch does. A hand-built
        // `new DOMException(..., 'AbortError')` is jsdom's cross-realm class
        // here and fails `instanceof Error`, which is not what a browser throws.
        signal?.addEventListener('abort', () => {
          reject(signal.reason as Error);
        });
      }
      requests.push({
        signal,
        respond: (payload: unknown, status = 200) => {
          resolve(createMockJsonResponse(payload, status));
        },
      });
    });
  });
  return {
    impl,
    requests,
  };
}

/**
 * Renders `useHook` against a deferred fetch so tests can start requests,
 * inspect their abort signals, and settle them out of order.
 * `startRequest` runs one hook operation inside `act` without awaiting it,
 * so the request stays in flight and the returned promise can be asserted
 * on once the test settles it.
 */
export function renderDeferredEndpoint<THook>(
  useHook: () => THook,
  options: { rejectOnAbort?: boolean } = {},
) {
  const deferred = createDeferredMockFetch(options);
  mockAuthenticatedFetch.mockImplementation(deferred.impl);
  const rendered = renderHook(useHook);

  const startRequest = <TResult>(run: (hook: THook) => Promise<TResult>): Promise<TResult> => {
    const started: Promise<TResult>[] = [];
    act(() => {
      started.push(run(rendered.result.current));
    });
    return started[0];
  };

  return {
    deferred,
    startRequest,
    ...rendered,
  };
}

/** The deferred variant of `renderProbeEndpoint`, with `startFetch(keyword)` sugar over `startRequest`. */
export function renderDeferredProbeEndpoint(options: { rejectOnAbort?: boolean } = {}) {
  const config = buildProbeEndpoint();
  const rendered = renderDeferredEndpoint(() => useAnalysisEndpoint(config), options);
  return {
    config,
    startFetch: (keyword: string) => rendered.startRequest((hook) => hook.fetchData(keyword)),
    ...rendered,
  };
}


/**
 * The superseded-fetch scenario: start `first`, start `second` (which aborts
 * `first`), then settle `second` with `payload`. Returns the still-pending
 * promise of the stale fetch and the rendered hook so a spec can assert what
 * happens when the stale one settles — or never does.
 */
export async function renderSupersededFetch(
  options: {
    rejectOnAbort?: boolean;
    payload?: ProbeResponse 
  } = {},
) {
  const rendered = renderDeferredProbeEndpoint({ rejectOnAbort: options.rejectOnAbort });
  const stale = rendered.startFetch('first');
  rendered.startFetch('second');
  await act(async () => {
    rendered.deferred.requests[1].respond(options.payload ?? newerProbeResponse);
  });
  return {
    stale,
    ...rendered,
  };
}
