import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';

/** Give every request a fresh response so its body can be read once. */
export function respondWith(status: number, body: unknown): void {
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse(body, status)));
}

export function lastRequest(): {
  url: string;
  init: RequestInit | undefined;
} {
  const calls = mockAuthenticatedFetch.mock.calls;
  const [url, init] = calls[calls.length - 1];
  return {
    url,
    init
  };
}
