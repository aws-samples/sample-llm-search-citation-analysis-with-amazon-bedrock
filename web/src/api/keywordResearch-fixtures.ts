import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';

/** Give every request a fresh response so its body can be read once. */
export function respondWith(status: number, body: unknown): void {
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse(body, status)));
}

/** The JSON body of the last request, parsed. */
export function lastRequestBody(): Record<string, unknown> {
  return JSON.parse(String(lastRequest().init?.body)) as Record<string, unknown>;
}

/** The URL and HTTP method of the last request. */
export function lastRequestTarget(): {
  url: string;
  method: string | undefined;
} {
  const {
    url, init
  } = lastRequest();
  return {
    url,
    method: init?.method,
  };
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
