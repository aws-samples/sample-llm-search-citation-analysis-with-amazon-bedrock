import {
  describe, expect, it, vi
} from 'vitest';
import {
  clampRows, ExportCancelledError, exportPlan, fetchAllChunks, priceText, type ExportChunk, type FetchChunk
} from './paidExport';
import { LABS_EXPORT } from '../api/seoDomains-fixtures';
import { BACKLINKS_EXPORT } from '../api/seoBacklinks-fixtures';
import {
  askedWindows, fakeList, WINDOWS_OF_2500
} from './paidExport-fixtures';

describe('exportPlan', () => {
  it('asks the remainder in the last chunk', () => {
    expect(exportPlan(2500, LABS_EXPORT).chunks).toStrictEqual([
      {
        offset: 0,
        limit: 1000,
      },
      {
        offset: 1000,
        limit: 1000,
      },
      {
        offset: 2000,
        limit: 500,
      },
    ]);
  });

  it('counts one request per started thousand rows', () => {
    expect([exportPlan(1000, LABS_EXPORT).requests, exportPlan(1001, LABS_EXPORT).requests]).toStrictEqual([1, 2]);
  });

  it('prices the requests plus the rows of a Labs export', () => {
    expect(exportPlan(2500, LABS_EXPORT).priceUsd).toBeCloseTo(0.336, 10);
  });

  it('prices the requests plus the rows of a backlinks export', () => {
    expect(exportPlan(1000, BACKLINKS_EXPORT).priceUsd).toBeCloseTo(0.06, 10);
  });
});

describe('priceText', () => {
  it.each([
    [0.132, 'up to $0.14'],
    [0.06, 'up to $0.06'],
    [0.024 + 0.036, 'up to $0.06'],
    [0.336, 'up to $0.34'],
    [0.0004, 'up to $0.01'],
    [0, 'up to $0.00'],
  ])('words %s USD as "%s"', (usd, text) => {
    expect(priceText(usd)).toBe(text);
  });

  it('prices 1000 Labs rows at "up to $0.14"', () => {
    expect(priceText(exportPlan(1000, LABS_EXPORT).priceUsd)).toBe('up to $0.14');
  });

  it('prices 2500 backlinks rows at "up to $0.17"', () => {
    expect(priceText(exportPlan(2500, BACKLINKS_EXPORT).priceUsd)).toBe('up to $0.17');
  });
});

describe('clampRows', () => {
  it.each([
    [500, 500],
    [12_000, 10_000],
    [10_000, 10_000],
    [2.7, 2],
    [1, 1],
  ])('reads %s as %s rows under a 10,000 cap', (input, rows) => {
    expect(clampRows(input, 10_000)).toBe(rows);
  });

  it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY])('refuses %s', (input) => {
    expect(clampRows(input, 10_000)).toBeNull();
  });
});

describe('fetchAllChunks', () => {
  const plan = exportPlan(2500, LABS_EXPORT).chunks;

  it('returns the rows of every chunk in order', async () => {
    const rows = await fetchAllChunks(plan, fakeList(5000), { signal: new AbortController().signal });

    expect([rows.length, rows[0], rows[rows.length - 1]]).toStrictEqual([2500, 0, 2499]);
  });

  it('asks the chunks one after the other', async () => {
    const fetchChunk = fakeList(5000);
    await fetchAllChunks(plan, fetchChunk, { signal: new AbortController().signal });

    expect(askedWindows(fetchChunk)).toStrictEqual(WINDOWS_OF_2500);
  });

  it('starts a request only once the one before has answered', async () => {
    const order: string[] = [];
    const fetchChunk = vi.fn<FetchChunk<number>>(async (offset) => {
      order.push(`start ${offset}`);
      await Promise.resolve();
      order.push(`end ${offset}`);
      return Array.from({ length: 1000 }, () => offset);
    });
    await fetchAllChunks(exportPlan(2000, LABS_EXPORT).chunks, fetchChunk, { signal: new AbortController().signal });

    expect(order).toStrictEqual(['start 0', 'end 0', 'start 1000', 'end 1000']);
  });

  it('stops after a chunk shorter than asked (the end of the list)', async () => {
    const fetchChunk = fakeList(1200);
    const rows = await fetchAllChunks(plan, fetchChunk, { signal: new AbortController().signal });

    expect([rows.length, fetchChunk.mock.calls.length]).toStrictEqual([1200, 2]);
  });

  it('reports each chunk before asking it', async () => {
    const onProgress = vi.fn<(chunk: ExportChunk, index: number) => void>();
    await fetchAllChunks(plan, fakeList(5000), {
      signal: new AbortController().signal,
      onProgress,
    });

    expect(onProgress.mock.calls).toStrictEqual(plan.map((chunk, index) => [chunk, index]));
  });

  it('asks nothing more once the signal aborts between two chunks', async () => {
    const controller = new AbortController();
    const fetchChunk = vi.fn<FetchChunk<number>>((offset, limit) => {
      controller.abort();
      return Promise.resolve(Array.from({ length: limit }, () => offset));
    });

    await expect(fetchAllChunks(plan, fetchChunk, { signal: controller.signal })).rejects.toThrow(ExportCancelledError);
    expect(fetchChunk.mock.calls).toHaveLength(1);
  });
});
