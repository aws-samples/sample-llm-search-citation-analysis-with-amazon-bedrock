import type { ComputingResponse } from '../types/domain/scopeCoverage';

/** The state overrides a scoped hook fixture accepts. */
export interface ScopedHookStateOverrides {
  readonly loading?: boolean;
  readonly error?: string | null;
  /** The 202 view job the request waits for. */
  readonly computing?: ComputingResponse | null;
}

/**
 * The status fields of a 2.45.0 scoped hook result: idle and error-free unless overridden, no
 * view job, and no answered request.
 */
export function scopedHookState(overrides: ScopedHookStateOverrides = {}) {
  return {
    loading: overrides.loading ?? false,
    error: overrides.error ?? null,
    computing: overrides.computing ?? null,
    request: null,
  };
}
