/**
 * The 2.45.0 scoped-response examples (`test-fixtures/scope-snapshots/`) as the dashboard
 * specs consume them: a plain record per route and case, read through the contract guard.
 */
import { fixtureBody } from '../types/domain/scopeCoverage-fixtures';
import type { ScopedResponseFields } from '../types/domain/scopeCoverage';
import { hasScopedResponseFields } from '../types/domain/scopeCoverageDecoders';

export type ScopedFixture = Record<string, unknown> & ScopedResponseFields;

/** One route's example body as a record; throws when the case is not a scoped JSON object. */
export function scopedFixture(route: string, caseName: string): ScopedFixture {
  const body = fixtureBody(route, caseName);
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new TypeError(`${route}/${caseName} is not a JSON object`);
  }
  const record: Record<string, unknown> = { ...body };
  if (!hasScopedResponseFields(record)) throw new TypeError(`${route}/${caseName} is not a scoped body`);
  return record;
}

/** The array under `key` of one route's example body; throws when there is none. */
export function fixtureList(route: string, caseName: string, key: string): unknown[] {
  const list = scopedFixture(route, caseName)[key];
  if (!Array.isArray(list)) throw new TypeError(`${route}/${caseName} has no ${key} list`);
  return list;
}
