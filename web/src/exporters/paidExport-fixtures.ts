/**
 * Chunk fetchers for the specs of `./paidExport` and `PaidExportModal`: a list of numbered rows, a request that never
 * answers, one that fails, and the windows a fetcher was asked.
 */
import { vi } from 'vitest';
import type { FetchChunk } from './paidExport';
import { TestError } from '../test/testError';

/** The windows (`[offset, limit]`) of an export of 2500 rows in requests of 1000. */
export const WINDOWS_OF_2500 = [[0, 1000], [1000, 1000], [2000, 500]];

/** `limit` rows from `offset` of a list of `total` rows numbered from 0. */
export function listRows(total: number, offset: number, limit: number): number[] {
  return Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_unused, index) => offset + index);
}

/** A list of `total` rows numbered from 0, answering each chunk with the rows it holds. */
export function fakeList(total: number) {
  return vi.fn<FetchChunk<number>>((offset, limit) => Promise.resolve(listRows(total, offset, limit)));
}

/** A request still in flight when the spec looks. */
export function fakeStalledFetch() {
  return vi.fn<FetchChunk<number>>(() => new Promise(vi.fn()));
}

/** A request DataForSEO refuses with `message`. */
export function fakeFailingFetch(message: string) {
  return vi.fn<FetchChunk<number>>().mockRejectedValue(new TestError(message));
}

/** The `[offset, limit]` of every chunk `fetchChunk` was asked, in order. */
export function askedWindows(fetchChunk: ReturnType<typeof fakeList>): number[][] {
  return fetchChunk.mock.calls.map(([offset, limit]) => [offset, limit]);
}
