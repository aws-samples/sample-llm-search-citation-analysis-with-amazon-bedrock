import {
  describe, it, expect
} from 'vitest';
import { renderHook } from '@testing-library/react';
import { useReportReady } from './useReportReady';
import {
  failedSlice, LOADING_SLICE, settledSlice
} from './reportSlice-fixtures';

/**
 * `useReportReady` is the single source of truth for "all the report's data
 * has loaded — go ahead and auto-print". The semantics tested here:
 *
 * - empty input is trivially ready (nothing to wait for)
 * - any slice still loading => not ready
 * - a slice that has settled with a value (data !== null) is ready
 * - a slice that has settled with an error is also ready (don't block print
 *   on a failed fetch — the section will render its error state)
 * - a slice that has settled with neither data nor error is NOT ready —
 *   that's the brief moment between mount and the first fetch starting,
 *   when `loading` is still false but `data` is still null
 */
describe('useReportReady', () => {
  it.each([
    ['returns true when slice list is empty', [], true],
    ['returns false when any slice is loading', [settledSlice({ ok: true }), LOADING_SLICE], false],
    ['returns true when every slice has resolved data', [settledSlice({ a: 1 }), settledSlice({ b: 2 })], true],
    ['treats a settled error as ready (so print is not blocked by a failed fetch)', [failedSlice('boom'), settledSlice({ ok: true })], true],
    ['returns false when a slice is settled but has no data and no error', [settledSlice(null)], false],
  ])('%s', (_name, slices, ready) => {
    const { result } = renderHook(() => useReportReady(slices));

    expect(result.current).toBe(ready);
  });
});
