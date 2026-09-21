import {
  ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
  CONTENT_STUDIO_BATCH_STORAGE_VERSION,
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

export function storeBatchCandidateEntries(
  entries: readonly StoredBatchCandidateEntry[]
): void {
  localStorage.setItem(
    ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
    JSON.stringify({
      version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
      entries,
    })
  );
}

export function storedBatchCandidateState(): unknown {
  const rawState = localStorage.getItem(
    ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY
  );
  return rawState === null ? null : JSON.parse(rawState);
}
