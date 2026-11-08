/**
 * The 2.45.0 contract every scoped response shares (`lambda/shared/snapshot_artifacts.py`;
 * example bodies per route in `test-fixtures/scope-snapshots/`).
 *
 * A scoped view is computed live for small scopes and served from a per-run
 * scope snapshot for large ones; a combination no snapshot holds answers
 * `202` while a view job computes it. List pages whose snapshot build is gone,
 * or whose keyword set changed, answer `400` `cursor_expired`.
 *
 * `@public` marks contract exports the dashboard does not read yet (track S5
 * builds the UI on them); knip skips them until then.
 */

/**
 * How many of the scope's keywords the figures include.
 */
export interface ScopeCoverage {
  keywords_total: number;
  keywords_analyzed: number;
  /** Every keyword of the scope is included. */
  complete: boolean;
}

/**
 * `live`: computed for this request. `snapshot`: read from the build of `as_of`.
 * @public
 */
export type ScopeSource = 'live' | 'snapshot';

/**
 * Where the figures come from and how current they are.
 * @public
 */
export interface ScopeSourceEnvelope {
  source: ScopeSource;
  /** When the snapshot was built; `null` for live figures. */
  as_of: string | null;
  /** The scope changed since the build (keywords, brand config, personas): the figures are the previous ones. */
  stale: boolean;
  /** A rebuild is running; refetch until `stale` is false. */
  refreshing: boolean;
}

/**
 * The common fields as a scoped response carries them; every one is absent from API builds before 2.45.0.
 */
export interface ScopedResponseFields {
  coverage?: ScopeCoverage;
  source?: ScopeSource;
  as_of?: string | null;
  stale?: boolean;
  refreshing?: boolean;
}

/**
 * The view job computing a `202` answer.
 * @public
 */
export interface ViewJob {
  id: string;
  started_at: string;
}

/**
 * `202` body: repeat the same GET after `retry_after_ms` (backing off) until it answers `200`.
 */
export interface ComputingResponse {
  status: 'computing';
  job: ViewJob;
  retry_after_ms: number;
}

/**
 * `200` body answered once for a view job that failed; the next GET starts it again.
 * @public
 */
export interface FailedViewJobResponse {
  status: 'failed';
  message: string;
}

/**
 * `400` body of a list cursor that no longer applies: restart the list without `next_token`.
 * @public
 */
export interface CursorExpiredBody {
  error: string;
  code: 'cursor_expired';
  field: string;
}
