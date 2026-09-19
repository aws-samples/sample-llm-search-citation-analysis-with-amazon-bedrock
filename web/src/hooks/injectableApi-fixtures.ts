import { vi } from 'vitest';
import { createMockJsonResponse } from '../test/fetchResponses';

/**
 * One method of an injectable hook API (`useBrandConfig(api)`,
 * `useOnboardingStatus(enabled, api)`): answers HTTP 500 when `shouldFail`,
 * otherwise the JSON payload. Each call builds a fresh `Response`, so every
 * request gets a readable body.
 */
export function createMockEndpoint(shouldFail: boolean | undefined, payload: unknown) {
  return vi.fn(() => Promise.resolve(
    shouldFail ? createMockJsonResponse({}, 500) : createMockJsonResponse(payload)
  ));
}
