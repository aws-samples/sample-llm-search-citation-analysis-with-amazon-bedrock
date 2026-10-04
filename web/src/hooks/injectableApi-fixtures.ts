import { vi } from 'vitest';
import { createMockJsonResponse } from '../test/fetchResponses';

/**
 * One method of an injectable hook API (`useBrandConfig(api)`,
 * `useOnboardingStatus(enabled, api)`): answers HTTP 500 when `shouldFail`,
 * otherwise HTTP 200, with the same JSON payload either way so a hook that
 * reads a failed response's body is caught. Each call builds a fresh
 * `Response`, so every request gets a readable body.
 */
export function createMockEndpoint(shouldFail: boolean | undefined, payload: unknown) {
  return vi.fn(() => Promise.resolve(
    createMockJsonResponse(payload, shouldFail ? 500 : 200)
  ));
}
