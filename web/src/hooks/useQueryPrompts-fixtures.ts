import { expect } from 'vitest';
import {
  renderHook, waitFor 
} from '@testing-library/react';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import { useQueryPrompts } from './useQueryPrompts';

export const samplePrompt = {
  id: 'p1',
  name: 'Family Traveler',
  template: 'As a family traveler, find {keyword}',
  enabled: 'true',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
};

/**
 * Renders the hook against a `GET /query-prompts` that answers `[samplePrompt]`
 * and waits for that initial load to finish. Queue a `mockImplementationOnce`
 * afterwards to script the next (mutating) request.
 */
export async function renderLoadedQueryPrompts() {
  mockAuthenticatedFetch.mockImplementation(() => Promise.resolve(createMockJsonResponse([samplePrompt])));
  const rendered = renderHook(() => useQueryPrompts());
  await waitFor(() => expect(rendered.result.current.loading).toBe(false));
  return rendered;
}

/** Scripts the next `authenticatedFetch` call to answer `payload` with `status`. */
export function respondOnce(payload: unknown, status = 200): void {
  mockAuthenticatedFetch.mockImplementationOnce(() => Promise.resolve(createMockJsonResponse(payload, status)));
}
