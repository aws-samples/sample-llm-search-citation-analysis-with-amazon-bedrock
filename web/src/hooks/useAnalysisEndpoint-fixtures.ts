import { vi } from 'vitest';

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

export function isProbeResponse(data: unknown): data is ProbeResponse {
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

export function buildProbeEndpoint() {
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

export function createMockFetch(options: {
  response?: unknown;
  shouldFail?: boolean;
  failStatus?: number;
} = {}) {
  return vi.fn().mockImplementation(() => {
    if (options.shouldFail) {
      return Promise.resolve({
        ok: false,
        status: options.failStatus ?? 500,
      });
    }

    return Promise.resolve({
      ok: true,
      json: () => Promise.resolve(options.response ?? probeResponse),
    });
  });
}

export interface RecordedAnalysisRequest {
  signal: AbortSignal | undefined;
  respond: (payload: unknown) => void;
}

function buildOkJsonResponse(payload: unknown) {
  return {
    ok: true,
    json: () => Promise.resolve(payload),
  };
}

/**
 * Mock fetch that never settles on its own: each call is recorded so
 * tests can resolve responses out of order and inspect abort signals.
 * With `rejectOnAbort` the pending promise rejects with an AbortError
 * when its signal aborts (real fetch behaviour); without it the mock
 * ignores the abort, simulating a stale response that still arrives.
 */
export function createDeferredMockFetch(options: { rejectOnAbort?: boolean } = {}) {
  const requests: RecordedAnalysisRequest[] = [];
  const impl = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    const signal = init?.signal ?? undefined;
    return new Promise((resolve, reject) => {
      if (options.rejectOnAbort) {
        signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }
      requests.push({
        signal,
        respond: (payload: unknown) => {
          resolve(buildOkJsonResponse(payload));
        },
      });
    });
  });
  return {
    impl,
    requests,
  };
}
