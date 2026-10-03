import { expect } from 'vitest';

/**
 * The exact state an endpoint hook returns before its first fetch: no data,
 * not loading, no error, and each of `functionNames` as a function.
 */
export function idleEndpointState(...functionNames: readonly string[]): Record<string, unknown> {
  const anyFunction: unknown = expect.any(Function);
  return {
    data: null,
    loading: false,
    error: null,
    ...Object.fromEntries(functionNames.map((name) => [name, anyFunction])),
  };
}
