import {
  afterEach, beforeEach, describe, expect, it, vi
} from 'vitest';
import {
  ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
  CONTENT_STUDIO_BATCH_STORAGE_VERSION,
  addStoredContentStudioBatchCandidate,
  boundedContentStudioBatchCandidates,
  readStoredContentStudioBatchCandidates,
  removeStoredContentStudioBatchCandidates,
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

class TestStorageError extends Error {
  constructor() {
    super('Storage unavailable');
    this.name = 'TestStorageError';
  }
}

const originalLocalStorage = globalThis.localStorage;

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: originalLocalStorage,
  });
  localStorage.clear();
});

describe('Content Studio active batch candidate storage', () => {
  it('uses the exact v2 localStorage key and schema version', () => {
    expect(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY)
      .toBe('contentStudio.activeBatchCandidates.v2');
    expect(CONTENT_STUDIO_BATCH_STORAGE_VERSION).toBe(2);
  });

  it('returns no candidates without mutating storage when both keys are absent', () => {
    const {
      removeItemSpy, setItemSpy
    } = spyOnStorageMutations();

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([]);
    expect(setItemSpy).toHaveBeenCalledTimes(0);
    expect(removeItemSpy).toHaveBeenCalledTimes(0);
  });

  it('migrates legacy string IDs once with expired-safe timestamps', () => {
    storeLegacyBatchIdsValue(JSON.stringify(['batch-1', 'batch-1', 'batch-2']));

    const migrated = [
      buildBatchCandidate('batch-1', 0),
      buildBatchCandidate('batch-2', 0),
    ];

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual(migrated);
    expect(storedLegacyBatchIdsValue()).toBeNull();
    expect(storedBatchCandidateState()).toStrictEqual(buildBatchCandidateState(migrated));
  });

  it.each([
    '{broken',
    JSON.stringify({
      version: 1,
      entries: [],
    }),
    JSON.stringify(['batch-1']),
  ])('clears malformed v2 candidate state when value is %s', (storedState) => {
    storeBatchCandidateValue(storedState);

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([]);
    expect(storedBatchCandidateValue()).toBeNull();
  });

  it('bounds malformed and future timestamps when candidate entries are recovered', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    storeBatchCandidateEntries([
      {
        id: 'future',
        registeredAt: 5_000,
      },
      {
        id: 'malformed',
        registeredAt: 'yesterday',
      },
      {
        id: 'negative',
        registeredAt: -20,
      },
      {
        id: '',
        registeredAt: 900,
      },
    ]);

    const bounded = [
      buildBatchCandidate('future', 1_000),
      buildBatchCandidate('malformed', 0),
      buildBatchCandidate('negative', 0),
    ];

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual(bounded);
    expect(storedBatchCandidateState()).toStrictEqual(buildBatchCandidateState(bounded));
  });

  it('keeps the newest registration when duplicate IDs are bounded', () => {
    expect(boundedContentStudioBatchCandidates([
      buildBatchCandidate('', 500),
      buildBatchCandidate('batch-1', 100),
      buildBatchCandidate('batch-2', 200),
      buildBatchCandidate('batch-1', 300),
    ], 1_000)).toStrictEqual([
      buildBatchCandidate('batch-1', 300),
      buildBatchCandidate('batch-2', 200),
    ]);
  });

  it('evicts the oldest candidate when an eleventh ID is added', () => {
    storeBatchCandidateEntries(Array.from({ length: 10 }, (_, index) => (
      buildBatchCandidate(`batch-${index + 1}`, index + 1)
    )));

    const stored = addStoredContentStudioBatchCandidate(
      buildBatchCandidate('batch-11', 11)
    );

    expect(stored.map((candidate) => candidate.id)).toStrictEqual([
      'batch-11', 'batch-10', 'batch-9', 'batch-8', 'batch-7',
      'batch-6', 'batch-5', 'batch-4', 'batch-3', 'batch-2',
    ]);
    expect(readStoredContentStudioBatchCandidates()).toStrictEqual(stored);
  });

  it('moves an updated candidate first without duplicating its ID', () => {
    storeBatchCandidateEntries([
      buildBatchCandidate('batch-2', 200),
      buildBatchCandidate('batch-1', 100),
    ]);

    const stored = addStoredContentStudioBatchCandidate(
      buildBatchCandidate('batch-1', 300)
    );

    expect(stored).toStrictEqual([
      buildBatchCandidate('batch-1', 300),
      buildBatchCandidate('batch-2', 200),
    ]);
  });

  it('retains a newer same-ID registration when stale cleanup completes', () => {
    storeBatchCandidateEntries([buildBatchCandidate('batch-1', 200)]);

    const stored = removeStoredContentStudioBatchCandidates([
      buildBatchCandidate('batch-1', 100),
    ]);

    expect(stored).toStrictEqual([buildBatchCandidate('batch-1', 200)]);
    expect(readStoredContentStudioBatchCandidates()).toStrictEqual(stored);
  });

  it('removes the v2 key when every exact candidate is terminal', () => {
    storeBatchCandidateEntries([buildBatchCandidate('batch-1', 100)]);

    expect(removeStoredContentStudioBatchCandidates([
      buildBatchCandidate('batch-1', 100),
    ])).toStrictEqual([]);
    expect(storedBatchCandidateValue()).toBeNull();
  });

  it('keeps in-memory candidates bounded when browser writes are unavailable', () => {
    mockRejectedStorageWrites(new TestStorageError());

    expect(addStoredContentStudioBatchCandidate(
      buildBatchCandidate('batch-1', 100)
    )).toStrictEqual([buildBatchCandidate('batch-1', 100)]);
  });

  it('returns no recovered candidates when localStorage is unavailable', () => {
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => {
        throw new TestStorageError();
      },
    });

    expect(readStoredContentStudioBatchCandidates()).toStrictEqual([]);
  });
});
