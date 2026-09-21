import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { fetchContentBriefBatch } from '../api/contentStudio';
import {
  ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY,
  ACTIVE_CONTENT_STUDIO_BATCH_LIMIT,
  LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY,
  addStoredContentStudioBatchCandidate,
  boundedContentStudioBatchCandidates,
  readStoredContentStudioBatchCandidates,
  removeStoredContentStudioBatchCandidates,
  type ContentStudioBatchCandidate,
} from '../api/contentStudioBatchStorage';
import { ApiRequestError } from '../infrastructure';
import type {
  ContentBriefBatchCounts,
  ContentBriefBatchStartResponse,
  ContentBriefBatchStatusResponse,
  ContentStudioHistory,
} from '../types';

const BATCH_POLL_INTERVAL = 10000;
export const CONTENT_STUDIO_BATCH_NOT_FOUND_GRACE_MS = 5 * 60 * 1000;

interface MountedRef { current: boolean; }

interface BatchPollResult {
  readonly candidate: ContentStudioBatchCandidate;
  readonly operation: symbol;
  readonly batch: ContentBriefBatchStatusResponse | null;
}

interface CommittedBatchPollOutcomes {
  readonly batches: ContentBriefBatchStatusResponse[];
  readonly terminalCandidates: ContentStudioBatchCandidate[];
  readonly expiredNotFoundCandidates: ContentStudioBatchCandidate[];
}

function batchCountsFromStart(
  response: ContentBriefBatchStartResponse
): ContentBriefBatchCounts {
  const counts: ContentBriefBatchCounts = {
    pending: 0,
    generating: 0,
    generated: 0,
    failed: 0,
    missing: 0,
    total: response.children.length,
  };
  for (const child of response.children) counts[child.status] += 1;
  return counts;
}

function trackedBatchFromStart(
  response: ContentBriefBatchStartResponse
): ContentBriefBatchStatusResponse {
  return {
    batch_id: response.batch_id,
    batch_size: response.batch_size,
    counts: batchCountsFromStart(response),
    children: response.children.map((child) => ({
      id: child.id,
      idea_id: child.idea_id,
      keyword_id: child.keyword_id,
      keyword: child.keyword,
      status: child.status,
      batch_position: child.batch_position,
      created_at: null,
      updated_at: null,
      has_content: child.status === 'generated',
      error_message: null,
    })),
  };
}

function batchIsRunning(batch: ContentBriefBatchStatusResponse): boolean {
  return batch.counts.pending + batch.counts.generating > 0;
}

function mergeActiveBatches(
  current: ContentBriefBatchStatusResponse[],
  incoming: ContentBriefBatchStatusResponse[]
): ContentBriefBatchStatusResponse[] {
  const incomingById = new Map<string, ContentBriefBatchStatusResponse>();
  for (const batch of incoming) incomingById.set(batch.batch_id, batch);
  const currentIds = new Set(current.map((batch) => batch.batch_id));
  return [
    ...incoming.filter((batch) => !currentIds.has(batch.batch_id)),
    ...current.map((batch) => incomingById.get(batch.batch_id) ?? batch),
  ].slice(0, ACTIVE_CONTENT_STUDIO_BATCH_LIMIT);
}

function prependActiveBatch(
  current: ContentBriefBatchStatusResponse[],
  incoming: ContentBriefBatchStatusResponse
): ContentBriefBatchStatusResponse[] {
  return [
    incoming,
    ...current.filter((batch) => batch.batch_id !== incoming.batch_id),
  ].slice(0, ACTIVE_CONTENT_STUDIO_BATCH_LIMIT);
}

function batchRequestWasNotFound(requestError: unknown): boolean {
  return requestError instanceof ApiRequestError && requestError.statusCode === 404;
}

function candidatesMatch(
  left: ContentStudioBatchCandidate,
  right: ContentStudioBatchCandidate
): boolean {
  return left.id === right.id && left.registeredAt === right.registeredAt;
}

function candidateListsMatch(
  left: readonly ContentStudioBatchCandidate[],
  right: readonly ContentStudioBatchCandidate[]
): boolean {
  return left.length === right.length
    && left.every((candidate, index) => candidatesMatch(candidate, right[index]));
}

function candidateIsWithinNotFoundGrace(
  candidate: ContentStudioBatchCandidate
): boolean {
  const age = Math.max(0, Date.now() - candidate.registeredAt);
  return age < CONTENT_STUDIO_BATCH_NOT_FOUND_GRACE_MS;
}

function collectCommittedPollOutcomes(
  results: readonly (BatchPollResult | null)[],
  commitTokens: Map<string, symbol>,
  candidateIsTracked: (candidate: ContentStudioBatchCandidate) => boolean
): CommittedBatchPollOutcomes {
  const batches = new Array<ContentBriefBatchStatusResponse>();
  // Stryker disable next-line ArrayDeclaration: An injected non-candidate sentinel is rejected by candidate identity checks before finalization and is observationally inert.
  const terminalCandidates = new Array<ContentStudioBatchCandidate>();
  const expiredNotFoundCandidates = new Array<ContentStudioBatchCandidate>();
  for (const result of results) {
    // Stryker disable next-line ConditionalExpression: Null/obsolete poll outcomes are pinned by overlap tests; forcing this guard false triggers a vitest-runner error-serialization crash instead of a reportable killed mutant.
    if (result === null || commitTokens.get(result.candidate.id) !== result.operation) continue;
    // Stryker disable next-line ConditionalExpression: Candidate replacement/removal invalidates the same commit token first; this identity guard documents that invariant defensively.
    if (!candidateIsTracked(result.candidate)) continue;
    if (result.batch !== null) {
      batches.push(result.batch);
      if (!batchIsRunning(result.batch)) terminalCandidates.push(result.candidate);
    } else if (!candidateIsWithinNotFoundGrace(result.candidate)) {
      expiredNotFoundCandidates.push(result.candidate);
    }
  }
  return {
    batches,
    terminalCandidates,
    expiredNotFoundCandidates,
  };
}

export function useContentStudioBatchTracking(
  refreshHistory: () => Promise<ContentStudioHistory[]>,
  mountedRef: MountedRef
) {
  const [activeBatches, setActiveBatches] = useState<ContentBriefBatchStatusResponse[]>([]);
  const [trackedCandidates, setTrackedCandidates] = useState<ContentStudioBatchCandidate[]>([]);
  const batchPollingRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const batchPollOperationsRef = useRef(new Map<string, symbol>());
  const batchPollCommitTokensRef = useRef(new Map<string, symbol>());
  const batchFinalizationsRef = useRef(new Map<string, number>());
  // Stryker disable next-line ArrayDeclaration: An injected non-candidate sentinel is discarded by the initial storage synchronization and cannot be observed.
  const trackedCandidatesRef = useRef(new Array<ContentStudioBatchCandidate>());

  // Stryker disable ArrayDeclaration: StrictMode explicitly exercises this once-per-setup dependency list.
  useEffect(() => () => {
    batchPollOperationsRef.current.clear();
    trackedCandidatesRef.current.length = 0;
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: mountedRef is a stable ref object for the hook lifetime.
  const replaceTrackedCandidates = useCallback((
    candidates: readonly ContentStudioBatchCandidate[]
  ): void => {
    const bounded = boundedContentStudioBatchCandidates(candidates);
    const boundedById = new Map(bounded.map((candidate) => [candidate.id, candidate]));
    for (const trackedCandidate of trackedCandidatesRef.current) {
      const replacement = boundedById.get(trackedCandidate.id);
      if (replacement === undefined || !candidatesMatch(trackedCandidate, replacement)) {
        batchPollOperationsRef.current.delete(trackedCandidate.id);
        batchPollCommitTokensRef.current.delete(trackedCandidate.id);
      }
    }
    trackedCandidatesRef.current = bounded;
    // Stryker disable next-line ConditionalExpression: React ignores post-unmount updates; the ref and durable store remain the observable cleanup behavior.
    if (mountedRef.current) setTrackedCandidates(bounded);
  }, [mountedRef]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: replaceTrackedCandidates has a stable callback identity.
  const rememberTrackedCandidate = useCallback((
    candidate: ContentStudioBatchCandidate
  ): void => {
    const stored = addStoredContentStudioBatchCandidate(candidate);
    replaceTrackedCandidates([
      candidate,
      ...stored,
      ...trackedCandidatesRef.current,
    ]);
  }, [replaceTrackedCandidates]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: replaceTrackedCandidates has a stable callback identity.
  const forgetTrackedCandidates = useCallback((
    candidates: readonly ContentStudioBatchCandidate[]
  ): void => {
    const stored = removeStoredContentStudioBatchCandidates(candidates);
    const local = trackedCandidatesRef.current.filter((tracked) => (
      !candidates.some((removed) => candidatesMatch(tracked, removed))
    ));
    const next = boundedContentStudioBatchCandidates([...stored, ...local]);
    if (candidateListsMatch(trackedCandidatesRef.current, next)) return;
    replaceTrackedCandidates(next);
  }, [replaceTrackedCandidates]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback contains no array data; the only array is its stable React dependency list.
  const registerBatchCandidate = useCallback((
    batchId: string
  ): ContentStudioBatchCandidate => {
    const candidate = {
      id: batchId,
      registeredAt: Date.now(),
    } satisfies ContentStudioBatchCandidate;
    rememberTrackedCandidate(candidate);
    return candidate;
  }, [rememberTrackedCandidate]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: Array.of preserves the candidate payload; the literal array is only the stable React dependency list.
  const discardBatchCandidate = useCallback((
    candidate: ContentStudioBatchCandidate
  ): void => {
    forgetTrackedCandidates(Array.of(candidate));
  }, [forgetTrackedCandidates]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback closes only over a stable ref; the array is its React dependency list.
  const candidateIsTracked = useCallback((candidate: ContentStudioBatchCandidate): boolean => (
    trackedCandidatesRef.current.some((tracked) => candidatesMatch(tracked, candidate))
  ), []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback contains no array data; the only array is its stable React dependency list.
  const fetchTrackedBatchOutcome = useCallback(async (
    candidate: ContentStudioBatchCandidate
  ): Promise<BatchPollResult | null> => {
    if (batchPollOperationsRef.current.has(candidate.id)
      || batchFinalizationsRef.current.get(candidate.id) === candidate.registeredAt) {
      return null;
    }
    const operation = Symbol();
    batchPollOperationsRef.current.set(candidate.id, operation);
    batchPollCommitTokensRef.current.set(candidate.id, operation);
    try {
      const batch = await fetchContentBriefBatch(candidate.id);
      return {
        candidate,
        operation,
        batch,
      };
    } catch (requestError) {
      if (!mountedRef.current
        || batchPollCommitTokensRef.current.get(candidate.id) !== operation) {
        return null;
      }
      if (batchRequestWasNotFound(requestError)) {
        return {
          candidate,
          operation,
          batch: null,
        };
      }
      console.error('[content] Error polling Content Brief batch:', requestError);
      return null;
    } finally {
      if (batchPollOperationsRef.current.get(candidate.id) === operation) {
        batchPollOperationsRef.current.delete(candidate.id);
      }
    }
  }, [mountedRef]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback contains no array data; the only array is its stable React dependency list.
  const finalizeTrackedCandidates = useCallback(async (
    candidates: readonly ContentStudioBatchCandidate[]
  ): Promise<void> => {
    const finalizing = candidates.filter((candidate) => (
      batchFinalizationsRef.current.get(candidate.id) !== candidate.registeredAt
    ));
    if (finalizing.length === 0) return;
    for (const candidate of finalizing) {
      batchFinalizationsRef.current.set(candidate.id, candidate.registeredAt);
    }
    try {
      await refreshHistory();
    } finally {
      for (const candidate of finalizing) {
        if (batchFinalizationsRef.current.get(candidate.id) === candidate.registeredAt) {
          batchFinalizationsRef.current.delete(candidate.id);
        }
      }
      forgetTrackedCandidates(finalizing);
    }
  }, [forgetTrackedCandidates, refreshHistory]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: concat preserves candidate data; the literal array is only the stable React dependency list.
  const pollTrackedBatches = useCallback(async (
    requestedCandidates?: readonly ContentStudioBatchCandidate[]
  ): Promise<void> => {
    const candidates = boundedContentStudioBatchCandidates(
      requestedCandidates ?? trackedCandidatesRef.current
    );
    const results = await Promise.all(candidates.map(fetchTrackedBatchOutcome));
    const {
      batches,
      terminalCandidates,
      expiredNotFoundCandidates,
    } = collectCommittedPollOutcomes(
      results,
      batchPollCommitTokensRef.current,
      candidateIsTracked
    );
    const expiredIds = new Set(expiredNotFoundCandidates.map((candidate) => candidate.id));
    if (batches.length > 0 || expiredIds.size > 0) {
      setActiveBatches((current) => mergeActiveBatches(
        current.filter((batch) => !expiredIds.has(batch.batch_id)),
        batches
      ));
    }
    await finalizeTrackedCandidates(
      terminalCandidates.concat(expiredNotFoundCandidates)
    );
  }, [candidateIsTracked, fetchTrackedBatchOutcome, finalizeTrackedCandidates]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback contains no array data; the only array is its stable React dependency list.
  const synchronizeFromStorage = useCallback(() => {
    const stored = readStoredContentStudioBatchCandidates();
    const current = trackedCandidatesRef.current;
    if (candidateListsMatch(current, stored)) return;
    const storedById = new Map<string, ContentStudioBatchCandidate>();
    for (const candidate of stored) storedById.set(candidate.id, candidate);
    const removed = current.filter((candidate) => !storedById.has(candidate.id));
    const currentById = new Map<string, ContentStudioBatchCandidate>();
    for (const candidate of current) currentById.set(candidate.id, candidate);
    const changed = stored.filter((candidate) => {
      const currentCandidate = currentById.get(candidate.id);
      return currentCandidate === undefined || !candidatesMatch(currentCandidate, candidate);
    });
    replaceTrackedCandidates(stored);
    if (removed.length > 0) {
      const removedIds = new Set(removed.map((candidate) => candidate.id));
      setActiveBatches((active) => active.filter((batch) => (
        !removedIds.has(batch.batch_id) || !batchIsRunning(batch)
      )));
    }
    void pollTrackedBatches(changed);
  }, [pollTrackedBatches, replaceTrackedCandidates]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This effect contains no array data; the only array is its stable React dependency list.
  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === null
        || event.key === ACTIVE_CONTENT_STUDIO_BATCH_CANDIDATES_STORAGE_KEY
        || event.key === LEGACY_CONTENT_STUDIO_BATCH_IDS_STORAGE_KEY) {
        synchronizeFromStorage();
      }
    };

    synchronizeFromStorage();
    globalThis.addEventListener('storage', handleStorage);
    return () => {
      globalThis.removeEventListener('storage', handleStorage);
    };
  }, [synchronizeFromStorage]);
  // Stryker restore ArrayDeclaration

  useEffect(() => {
    if (trackedCandidates.length === 0) return undefined;
    const interval = setInterval(
      () => void pollTrackedBatches(),
      BATCH_POLL_INTERVAL
    );
    batchPollingRef.current = interval;
    return () => {
      clearInterval(interval);
      batchPollingRef.current = null;
    };
  }, [pollTrackedBatches, trackedCandidates]);

  // Stryker disable ArrayDeclaration: Array.of preserves candidate data; the literal array is only the stable React dependency list.
  const trackBatchStart = useCallback((
    response: ContentBriefBatchStartResponse,
    candidate: ContentStudioBatchCandidate
  ): void => {
    if (!candidateIsTracked(candidate)) return;
    const batch = trackedBatchFromStart(response);
    setActiveBatches((current) => prependActiveBatch(current, batch));
    if (batchIsRunning(batch)) {
      void pollTrackedBatches(Array.of(candidate));
      return;
    }
    void finalizeTrackedCandidates(Array.of(candidate));
  }, [candidateIsTracked, finalizeTrackedCandidates, pollTrackedBatches]);
  // Stryker restore ArrayDeclaration

  return {
    activeBatches,
    registerBatchCandidate,
    discardBatchCandidate,
    trackBatchStart,
  };
}
