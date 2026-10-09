/**
 * Canned answers for `mockAuthenticatedFetch` (see `infrastructureMock.ts`).
 */
import { createMockJsonResponse } from './fetchResponses';
import { mockAuthenticatedFetch } from './infrastructureMock';

/** Answers every request with `body` and `status`, a fresh response each time so its body can be read once. */
export function answerEveryFetch(body: unknown, status = 200): void {
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse(body, status)));
}

/**
 * Answers each request with the body listed for its path (`/stats`), query
 * string ignored; a path not listed answers 404.
 */
export function answerFetchByPath(bodies: Readonly<Record<string, unknown>>): void {
  mockAuthenticatedFetch.mockImplementation((input) => {
    const { pathname } = new URL(String(input));
    return Promise.resolve(pathname in bodies
      ? createMockJsonResponse(bodies[pathname])
      : createMockJsonResponse({ error: 'not found' }, 404));
  });
}
