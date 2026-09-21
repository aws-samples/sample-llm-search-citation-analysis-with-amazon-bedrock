import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
  CONTENT_STUDIO_BATCH_STORAGE_VERSION,
  LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY,
  boundedContentStudioBatchCandidates,
  readStoredContentStudioBatchCandidates,
} from './contentStudioBatchStorage';
import {
  buildBatchCandidate,
  storeBatchCandidateEntries,
  storedBatchCandidateState,
} from './contentStudioBatchStorage-fixtures';

class RejectedStorageWriteError extends Error {
  constructor() {
    super('Storage write rejected');
    this.name = 'RejectedStorageWriteError';
  }
}

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('Content Studio batch candidate storage edge behavior', () => {
  it('uses the exact legacy key when migrating string IDs', () => {
    expect(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY)
      .toBe('contentStudio.activeBatchIds.v1');
  });

  it.each([
    JSON.stringify(null),
    JSON.stringify(42),
    JSON.stringify({
      version: 1,
      entries: [buildBatchCandidate('wrong-version', 100)],
    }),
    JSON.stringify({
      version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
      entries: { id: 'not-an-array' },
    }),
  ])('clears the v2 key when its envelope is malformed as %s', (storedState) => {
    localStorage.setItem(
      ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
      storedState
    );

    const candidates = readStoredContentStudioBatchCandidates();
    const currentState = localStorage.getItem(
      ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY
    );
    expect({
      candidates,
      currentState,
    }).toStrictEqual({
      candidates: [],
      currentState: null,
    });
  });

  it('drops malformed entries while preserving an exact valid candidate', () => {
    localStorage.setItem(
      ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
      JSON.stringify({
        version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
        entries: [
          null,
          [],
          {},
          {
            id: 2,
            registeredAt: 200,
          },
          {
            id: '',
            registeredAt: 300,
          },
          buildBatchCandidate('valid-batch', 400),
        ],
      })
    );

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('valid-batch', 400)
    ]);
    expect(storedBatchCandidateState()).toStrictEqual({
      version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
      entries: [buildBatchCandidate('valid-batch', 400)],
    });
  });

  it.each([
    JSON.stringify({ batchIds: ['batch-1'] }),
    JSON.stringify(['batch-1', 2]),
    JSON.stringify(42),
  ])('clears malformed legacy IDs when value is %s', (legacyState) => {
    localStorage.setItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY, legacyState);

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([]);
    expect(localStorage.getItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY)).toBeNull();
    expect(localStorage.getItem(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY))
      .toBeNull();
  });

  it('migrates valid legacy IDs after discarding malformed v2 state', () => {
    localStorage.setItem(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY, '{broken');
    localStorage.setItem(
      LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY,
      JSON.stringify(['batch-1'])
    );

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 0)
    ]);
    expect(storedBatchCandidateState()).toStrictEqual({
      version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
      entries: [buildBatchCandidate('batch-1', 0)],
    });
    expect(localStorage.getItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY)).toBeNull();
  });

  it('preserves valid v2 candidates after discarding malformed legacy state', () => {
    storeBatchCandidateEntries([buildBatchCandidate('batch-1', 100)]);
    localStorage.setItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY, '{broken');

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 100)
    ]);
    expect(storedBatchCandidateState()).toStrictEqual({
      version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
      entries: [buildBatchCandidate('batch-1', 100)],
    });
    expect(localStorage.getItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY)).toBeNull();
  });

  it('removes the v2 key when its normalized candidate list is empty', () => {
    storeBatchCandidateEntries([]);

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([]);
    expect(localStorage.getItem(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY))
      .toBeNull();
  });

  it('removes the legacy key when its normalized ID list is empty', () => {
    localStorage.setItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY, '[]');

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([]);
    expect(localStorage.getItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY)).toBeNull();
  });

  it('does not rewrite candidate state when it is already normalized', () => {
    storeBatchCandidateEntries([buildBatchCandidate('batch-1', 100)]);
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 100)
    ]);
    expect(setItemSpy).toHaveBeenCalledTimes(0);
    expect(removeItemSpy).toHaveBeenCalledTimes(0);
  });

  it('does not remove an absent legacy key when normalizing a future timestamp', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    storeBatchCandidateEntries([buildBatchCandidate('future-batch', 5_000)]);
    const removeItemSpy = vi.spyOn(Storage.prototype, 'removeItem');

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('future-batch', 1_000)
    ]);
    expect(removeItemSpy).toHaveBeenCalledTimes(0);
    expect(storedBatchCandidateState()).toStrictEqual({
      version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
      entries: [buildBatchCandidate('future-batch', 1_000)],
    });
  });

  it('removes an empty legacy key after preserving normalized v2 candidates', () => {
    storeBatchCandidateEntries([buildBatchCandidate('batch-1', 100)]);
    localStorage.setItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY, '[]');

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 100)
    ]);
    expect(localStorage.getItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY)).toBeNull();
  });

  it('preserves legacy IDs when writing their migration is rejected', () => {
    localStorage.setItem(
      LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY,
      JSON.stringify(['batch-1'])
    );
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new RejectedStorageWriteError();
    });

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 0)
    ]);
    expect(localStorage.getItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY))
      .toBe('["batch-1"]');
    expect(localStorage.getItem(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY))
      .toBeNull();
  });

  it('bounds non-finite in-memory timestamps to the expired-safe lower bound', () => {
    expect(boundedContentStudioBatchCandidates([
      buildBatchCandidate('nan-batch', Number.NaN),
      buildBatchCandidate('infinite-batch', Number.POSITIVE_INFINITY),
    ], 1_000)).toStrictEqual([
      buildBatchCandidate('nan-batch', 0),
      buildBatchCandidate('infinite-batch', 0),
    ]);
  });
});
