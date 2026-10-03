/**
 * Canned answers for `mockAuthenticatedFetch` (see `infrastructureMock.ts`).
 */
import { createMockJsonResponse } from './fetchResponses';
import { mockAuthenticatedFetch } from './infrastructureMock';

/** Answers every request with `body` and `status`, a fresh response each time so its body can be read once. */
export function answerEveryFetch(body: unknown, status = 200): void {
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse(body, status)));
}
