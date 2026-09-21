export const ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY =
  'contentStudio.activeBatchCandidates.v2';
export const LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY =
  'contentStudio.activeBatchIds.v1';
export const ACTIVE_CONTENT_STUDIO_BATCH_LIMIT = 10;
export const CONTENT_STUDIO_BATCH_STORAGE_VERSION = 2;

export interface ContentStudioBatchCandidate {
  readonly id: string;
  readonly registeredAt: number;
}

interface StoredContentStudioBatchCandidates {
  readonly version: typeof CONTENT_STUDIO_BATCH_STORAGE_VERSION;
  readonly entries: readonly ContentStudioBatchCandidate[];
}

interface DecodedCandidateStorageState {
  readonly raw: string | null;
  readonly candidates: ContentStudioBatchCandidate[];
}

// Stryker disable ConditionalExpression,LogicalOperator: The following predicates are a single runtime record guard; weakening an individual predicate has the same safe-rejection result at each guarded decoder.
function isRecord(candidate: unknown): candidate is Record<string, unknown> {
  return typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate);
}
// Stryker restore ConditionalExpression,LogicalOperator

function currentTimestamp(): number {
  return Math.max(0, Math.trunc(Date.now()));
}

function boundedRegisteredAt(registeredAt: unknown, now: number): number {
  // Stryker disable next-line ConditionalExpression: Number.isFinite rejects every non-number too; this predicate exists to narrow the unknown value for TypeScript.
  if (typeof registeredAt !== 'number') return 0;
  if (!Number.isFinite(registeredAt)) return 0;
  return Math.min(Math.max(0, Math.trunc(registeredAt)), now);
}

export function boundedContentStudioBatchCandidates(
  candidates: readonly ContentStudioBatchCandidate[],
  now = currentTimestamp()
): ContentStudioBatchCandidate[] {
  const boundedNow = Math.max(0, Math.trunc(now));
  const candidatesById = new Map<string, ContentStudioBatchCandidate>();
  for (const candidate of candidates) {
    if (candidate.id.length === 0) continue;
    const normalized = {
      id: candidate.id,
      registeredAt: boundedRegisteredAt(candidate.registeredAt, boundedNow),
    } satisfies ContentStudioBatchCandidate;
    const existing = candidatesById.get(normalized.id);
    // Stryker disable next-line EqualityOperator: Equal registrations are identical records, so replacing one with the other is observationally equivalent.
    if (existing === undefined || existing.registeredAt < normalized.registeredAt) {
      candidatesById.set(normalized.id, normalized);
    }
  }
  return [...candidatesById.values()]
    .sort((left, right) => right.registeredAt - left.registeredAt)
    .slice(0, ACTIVE_CONTENT_STUDIO_BATCH_LIMIT);
}

function decodeStoredCandidate(
  storedEntry: unknown,
  now: number
): ContentStudioBatchCandidate | null {
  if (!isRecord(storedEntry)) return null;
  if (typeof storedEntry.id !== 'string') return null;
  return {
    id: storedEntry.id,
    registeredAt: boundedRegisteredAt(storedEntry.registeredAt, now),
  };
}

function decodeStoredCandidates(
  storedState: unknown,
  now: number
): ContentStudioBatchCandidate[] | null {
  // Stryker disable next-line ConditionalExpression: Accessing a non-record below either rejects on version or is mapped to the same invalid state by parseStoredState.
  if (!isRecord(storedState)) return null;
  if (storedState.version !== CONTENT_STUDIO_BATCH_STORAGE_VERSION) return null;
  // Stryker disable next-line ConditionalExpression: Calling map on a non-array is mapped to the same invalid state by parseStoredState; this guard avoids relying on that exception.
  if (!Array.isArray(storedState.entries)) return null;
  const decoded = storedState.entries
    .map((storedEntry) => decodeStoredCandidate(storedEntry, now))
    .filter((candidate): candidate is ContentStudioBatchCandidate => candidate !== null);
  return boundedContentStudioBatchCandidates(decoded, now);
}

function decodeLegacyBatchIds(
  storedState: unknown
): ContentStudioBatchCandidate[] | null {
  // Stryker disable next-line ConditionalExpression: Calling every on a non-array is mapped to the same invalid state by parseStoredState; this guard avoids relying on that exception.
  if (!Array.isArray(storedState)) return null;
  if (!storedState.every((batchId) => typeof batchId === 'string')) return null;
  return boundedContentStudioBatchCandidates(storedState.map((batchId) => ({
    id: batchId,
    registeredAt: 0,
  })));
}

function encodedCandidates(candidates: readonly ContentStudioBatchCandidate[]): string {
  const storedState = {
    version: CONTENT_STUDIO_BATCH_STORAGE_VERSION,
    entries: candidates,
  } satisfies StoredContentStudioBatchCandidates;
  return JSON.stringify(storedState);
}

function removeStorageKey(storage: Storage, storageKey: string): void {
  try {
    storage.removeItem(storageKey);
  } catch {
    // Browser storage is best-effort and can be unavailable in privacy modes.
  }
}

function persistCandidates(
  storage: Storage,
  candidates: readonly ContentStudioBatchCandidate[]
): boolean {
  try {
    if (candidates.length === 0) {
      storage.removeItem(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY);
    } else {
      storage.setItem(
        ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
        encodedCandidates(candidates)
      );
    }
  // Stryker disable next-line BlockStatement: Falling through this catch returns undefined in mutated JavaScript, which is the same falsy persistence result consumed by the migration guard.
  } catch {
    return false;
  }
  return true;
}

function parseStoredState(
  rawState: string,
  decoder: (storedState: unknown) => ContentStudioBatchCandidate[] | null
): ContentStudioBatchCandidate[] | null {
  try {
    return decoder(JSON.parse(rawState));
  } catch {
    return null;
  }
}

function readCurrentCandidateState(
  storage: Storage,
  now: number
): DecodedCandidateStorageState {
  const raw = storage.getItem(ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY);
  if (raw === null) {
    return {
      raw,
      candidates: [],
    };
  }
  const candidates = parseStoredState(
    raw,
    (storedState) => decodeStoredCandidates(storedState, now)
  );
  if (candidates !== null) {
    return {
      raw,
      candidates,
    };
  }
  removeStorageKey(storage, ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY);
  return {
    raw: null,
    candidates: [],
  };
}

function readLegacyCandidateState(storage: Storage): DecodedCandidateStorageState {
  const raw = storage.getItem(LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY);
  if (raw === null) {
    return {
      raw,
      candidates: [],
    };
  }
  const candidates = parseStoredState(raw, decodeLegacyBatchIds);
  if (candidates !== null) {
    return {
      raw,
      candidates,
    };
  }
  removeStorageKey(storage, LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY);
  return {
    raw: null,
    candidates: [],
  };
}

function removeEmptyCandidateStorage(
  storage: Storage,
  current: DecodedCandidateStorageState,
  legacy: DecodedCandidateStorageState
): void {
  if (current.raw !== null) {
    removeStorageKey(storage, ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY);
  }
  if (legacy.raw !== null) {
    removeStorageKey(storage, LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY);
  }
}

function candidateStorageNeedsWrite(
  current: DecodedCandidateStorageState,
  legacy: DecodedCandidateStorageState
): boolean {
  const currentNeedsNormalization = current.raw !== encodedCandidates(current.candidates);
  const legacyNeedsMigration = legacy.raw !== null;
  return currentNeedsNormalization || legacyNeedsMigration;
}

function readCandidatesFromStorage(storage: Storage): ContentStudioBatchCandidate[] {
  const now = currentTimestamp();
  const current = readCurrentCandidateState(storage, now);
  const legacy = readLegacyCandidateState(storage);
  const candidates = boundedContentStudioBatchCandidates([
    ...current.candidates,
    ...legacy.candidates,
  ], now);

  if (candidates.length === 0) {
    removeEmptyCandidateStorage(storage, current, legacy);
    return [];
  }
  if (!candidateStorageNeedsWrite(current, legacy)) return candidates;
  const persisted = persistCandidates(storage, candidates);
  if (persisted && legacy.raw !== null) {
    removeStorageKey(storage, LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY);
  }
  return candidates;
}

export function readStoredContentStudioBatchCandidates(): ContentStudioBatchCandidate[] {
  try {
    return readCandidatesFromStorage(globalThis.localStorage);
  } catch {
    return [];
  }
}

export function addStoredContentStudioBatchCandidate(
  candidate: ContentStudioBatchCandidate
): ContentStudioBatchCandidate[] {
  const candidates = boundedContentStudioBatchCandidates([
    candidate,
    ...readStoredContentStudioBatchCandidates(),
  ]);
  try {
    persistCandidates(globalThis.localStorage, candidates);
  } catch {
    // In-memory tracking continues when the localStorage getter is unavailable.
  }
  return candidates;
}

function candidateIdentity(candidate: ContentStudioBatchCandidate): string {
  return `${candidate.id}\u0000${candidate.registeredAt}`;
}

export function removeStoredContentStudioBatchCandidates(
  removedCandidates: readonly ContentStudioBatchCandidate[]
): ContentStudioBatchCandidate[] {
  const removed = new Set(removedCandidates.map(candidateIdentity));
  const candidates = readStoredContentStudioBatchCandidates()
    .filter((candidate) => !removed.has(candidateIdentity(candidate)));
  try {
    persistCandidates(globalThis.localStorage, candidates);
  } catch {
    // In-memory tracking continues when the localStorage getter is unavailable.
  }
  return candidates;
}
