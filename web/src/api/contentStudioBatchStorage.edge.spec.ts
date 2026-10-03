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
  buildBatchCandidateState,
  mockRejectedStorageWrites,
  spyOnStorageMutations,
  storeBatchCandidateEntries,
  storeBatchCandidateValue,
  storeLegacyBatchIdsValue,
  storedBatchCandidateState,
  storedBatchCandidateValue,
  storedLegacyBatchIdsValue,
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
    storeBatchCandidateValue(storedState);

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
    storeBatchCandidateValue(JSON.stringify({
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
    expect(storedBatchCandidateState()).toStrictEqual(buildBatchCandidateState([buildBatchCandidate('valid-batch', 400)]));
  });

  it.each([
    JSON.stringify({ batchIds: ['batch-1'] }),
    JSON.stringify(['batch-1', 2]),
    JSON.stringify(42),
  ])('clears malformed legacy IDs when value is %s', (legacyState) => {
    storeLegacyBatchIdsValue(legacyState);

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([]);
    expect(storedLegacyBatchIdsValue()).toBeNull();
    expect(storedBatchCandidateValue()).toBeNull();
  });

  it('migrates valid legacy IDs after discarding malformed v2 state', () => {
    storeBatchCandidateValue('{broken');
    storeLegacyBatchIdsValue(JSON.stringify(['batch-1']));

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 0)
    ]);
    expect(storedBatchCandidateState()).toStrictEqual(buildBatchCandidateState([buildBatchCandidate('batch-1', 0)]));
    expect(storedLegacyBatchIdsValue()).toBeNull();
  });

  it('preserves valid v2 candidates after discarding malformed legacy state', () => {
    storeBatchCandidateEntries([buildBatchCandidate('batch-1', 100)]);
    storeLegacyBatchIdsValue('{broken');

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 100)
    ]);
    expect(storedBatchCandidateState()).toStrictEqual(buildBatchCandidateState([buildBatchCandidate('batch-1', 100)]));
    expect(storedLegacyBatchIdsValue()).toBeNull();
  });

  it('removes the v2 key when its normalized candidate list is empty', () => {
    storeBatchCandidateEntries([]);

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([]);
    expect(storedBatchCandidateValue()).toBeNull();
  });

  it('removes the legacy key when its normalized ID list is empty', () => {
    storeLegacyBatchIdsValue('[]');

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([]);
    expect(storedLegacyBatchIdsValue()).toBeNull();
  });

  it('does not rewrite candidate state when it is already normalized', () => {
    storeBatchCandidateEntries([buildBatchCandidate('batch-1', 100)]);
    const {
      removeItemSpy, setItemSpy
    } = spyOnStorageMutations();

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
    expect(storedBatchCandidateState()).toStrictEqual(buildBatchCandidateState([buildBatchCandidate('future-batch', 1_000)]));
  });

  it('removes an empty legacy key after preserving normalized v2 candidates', () => {
    storeBatchCandidateEntries([buildBatchCandidate('batch-1', 100)]);
    storeLegacyBatchIdsValue('[]');

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 100)
    ]);
    expect(storedLegacyBatchIdsValue()).toBeNull();
  });

  it('preserves legacy IDs when writing their migration is rejected', () => {
    storeLegacyBatchIdsValue(JSON.stringify(['batch-1']));
    mockRejectedStorageWrites(new RejectedStorageWriteError());

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([
      buildBatchCandidate('batch-1', 0)
    ]);
    expect(storedLegacyBatchIdsValue())
      .toBe('["batch-1"]');
    expect(storedBatchCandidateValue()).toBeNull();
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
