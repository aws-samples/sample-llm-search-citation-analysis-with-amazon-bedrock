import { vi } from 'vitest';
import {
  ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
  CONTENT_STUDIO_BATCH_STORAGE_VERSION,
  LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY,
  type ContentStudioBatchCandidate,
} from './contentStudioBatchStorage';

interface StoredBatchCandidateEntry {
  readonly id: string;
  readonly registeredAt: unknown;
}

export function buildBatchCandidate(
  id: string,
  registeredAt: number
): ContentStudioBatchCandidate {
  return {
    id,
    registeredAt,
  };
}

/** The versioned v2 envelope the candidate store persists. */
export function buildBatchCandidateState(entries: readonly StoredBatchCandidateEntry[]) {
  return {
    version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
    entries,
  };
}

/** The raw v2 key value, or null when the key is absent. */
export function storedBatchCandidateValue(): string | null {
  return localStorage.getItem(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY);
}

/** The raw legacy v1 key value, or null when the key is absent. */
export function storedLegacyBatchIdsValue(): string | null {
  return localStorage.getItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY);
}

export function storeBatchCandidateValue(value: string): void {
  localStorage.setItem(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY, value);
}

export function storeLegacyBatchIdsValue(value: string): void {
  localStorage.setItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY, value);
}

export function spyOnStorageMutations() {
  return {
    setItemSpy: vi.spyOn(Storage.prototype, 'setItem'),
    removeItemSpy: vi.spyOn(Storage.prototype, 'removeItem'),
  };
}

export function mockRejectedStorageWrites(error: Error): void {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw error;
  });
}

export function storeBatchCandidateEntries(
  entries: readonly StoredBatchCandidateEntry[]
): void {
  storeBatchCandidateValue(JSON.stringify(buildBatchCandidateState(entries)));
}

export function storedBatchCandidateState(): unknown {
  const rawState = localStorage.getItem(
    ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY
  );
  return rawState === null ? null : JSON.parse(rawState);
}
