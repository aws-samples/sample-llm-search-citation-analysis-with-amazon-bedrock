/**
 * Keyword groups API client.
 *
 * Groups are folders of keywords (typically one per hotel). Membership is
 * stored on each keyword as `group_ids`, so the bulk membership call returns
 * the updated keyword items for the caller to merge into its keyword state.
 */
import {
  apiDelete, apiGet, apiPost, apiPut
} from './client';
import type {
  Keyword, KeywordGroup
} from '../types';
import {
  isGroupMembershipResponse,
  isKeywordGroup,
  isKeywordGroupsResponse,
  isRecord,
} from '../types/domain/keywordDecoders';
import type { GroupMembershipResponse } from '../types/domain/keywordDecoders';
import { ApiRequestError } from '../infrastructure';
import {
  IncompleteWriteError, MAX_WRITE_ROUNDS
} from './writeRounds';

export class InvalidKeywordGroupResponseError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidKeywordGroupResponseError';
  }
}

function decodeGroup(payload: unknown): KeywordGroup {
  if (!isKeywordGroup(payload)) {
    throw new InvalidKeywordGroupResponseError('Keyword group API returned an invalid group');
  }
  return payload;
}

export async function fetchKeywordGroups(signal?: AbortSignal): Promise<KeywordGroup[]> {
  const payload = await apiGet<unknown>('/keyword-groups', { signal });
  if (!isKeywordGroupsResponse(payload)) {
    throw new InvalidKeywordGroupResponseError('Keyword group API returned an invalid list');
  }
  return payload.groups;
}

export async function createKeywordGroup(name: string, description = ''): Promise<KeywordGroup> {
  return decodeGroup(await apiPost<unknown>('/keyword-groups', {
    name,
    description
  }, { allowStructured4xx: true }));
}

export async function updateKeywordGroup(
  id: string,
  changes: {
    name?: string;
    description?: string 
  }
): Promise<KeywordGroup> {
  return decodeGroup(await apiPut<unknown>(
    `/keyword-groups/${encodeURIComponent(id)}`,
    changes,
    { allowStructured4xx: true }
  ));
}

/**
 * How many members a DELETE answer says still list the group: `null` when the
 * delete is finished, `undefined` when it is not but the count is unknown.
 */
function pendingMembers(payload: unknown): number | null | undefined {
  if (!isRecord(payload) || payload.truncated !== true) return null;
  return typeof payload.pending_members === 'number' ? payload.pending_members : undefined;
}

function keywordCount(count: number | undefined): string {
  if (count === undefined) return 'some keywords';
  return `${count} ${count === 1 ? 'keyword' : 'keywords'}`;
}

function incompleteDeletion(pending: number | undefined): IncompleteWriteError {
  return new IncompleteWriteError(
    `Group deleted, but ${keywordCount(pending)} still list it after ${MAX_WRITE_ROUNDS} attempts. Delete the group again to finish.`,
    pending ?? 0
  );
}

async function deleteGroupRound(endpoint: string, round: number, signal?: AbortSignal): Promise<void> {
  const payload = await apiDelete<unknown>(endpoint, {
    allowStructured4xx: true,
    ...(signal === undefined ? {} : { signal }),
  }).catch((failure: unknown) => {
    // A repeat that finds nothing listing the group: an earlier answer's pending members were detached since.
    if (round > 1 && failure instanceof ApiRequestError && failure.statusCode === 404) return null;
    throw failure;
  });
  const pending = pendingMembers(payload);
  if (pending === null) return;
  if (round >= MAX_WRITE_ROUNDS) throw incompleteDeletion(pending);
  await deleteGroupRound(endpoint, round + 1, signal);
}

/**
 * Deletes the group. The server answers 202 (`truncated`, `pending_members`)
 * when its time budget left keywords still listing the group; the same DELETE
 * is then sent again, at most `MAX_WRITE_ROUNDS` requests in all, after which
 * `IncompleteWriteError` says how many are left. An abort stops the rounds.
 */
export async function deleteKeywordGroup(id: string, signal?: AbortSignal): Promise<void> {
  await deleteGroupRound(`/keyword-groups/${encodeURIComponent(id)}`, 1, signal);
}

export interface MembershipChanges {
  add?: string[];
  remove?: string[];
}

/**
 * Most ids one membership request may carry per list; mirrors
 * `MAX_MEMBERSHIP_CHANGES` in `lambda/api/manage-keyword-groups.py`, which
 * rejects a longer `add` or `remove` list with a 400.
 */
export const MAX_MEMBERSHIP_CHANGES_PER_REQUEST = 500;

interface ChunkProgress {
  applied: GroupMembershipResponse;
  appliedChanges: number;
  totalChanges: number;
}

/**
 * A chunked membership change failed after at least one request succeeded.
 * `applied` merges the responses that did succeed; those changes are stored.
 */
export class PartialMembershipUpdateError extends Error {
  readonly applied: GroupMembershipResponse;
  readonly appliedChanges: number;
  readonly totalChanges: number;
  readonly failure: unknown;

  constructor(progress: ChunkProgress, failure: unknown) {
    super(`Applied ${progress.appliedChanges} of ${progress.totalChanges} keyword membership changes`);
    this.name = 'PartialMembershipUpdateError';
    this.applied = progress.applied;
    this.appliedChanges = progress.appliedChanges;
    this.totalChanges = progress.totalChanges;
    this.failure = failure;
  }
}

function countChanges(changes: MembershipChanges): number {
  return (changes.add?.length ?? 0) + (changes.remove?.length ?? 0);
}

function chunkOf(ids: string[] | undefined, chunkIndex: number): string[] | undefined {
  const start = chunkIndex * MAX_MEMBERSHIP_CHANGES_PER_REQUEST;
  return ids?.slice(start, start + MAX_MEMBERSHIP_CHANGES_PER_REQUEST);
}

/** Request bodies of at most the server cap per list; one body when both lists fit. */
function chunkMembershipChanges(changes: MembershipChanges): MembershipChanges[] {
  const requestCount = Math.max(
    1,
    Math.ceil((changes.add?.length ?? 0) / MAX_MEMBERSHIP_CHANGES_PER_REQUEST),
    Math.ceil((changes.remove?.length ?? 0) / MAX_MEMBERSHIP_CHANGES_PER_REQUEST)
  );
  return Array.from({ length: requestCount }, (_unused, chunkIndex) => {
    const add = chunkOf(changes.add, chunkIndex);
    const remove = chunkOf(changes.remove, chunkIndex);
    return {
      ...(add === undefined ? {} : { add }),
      ...(remove === undefined ? {} : { remove }),
    };
  });
}

function mergeMembershipResponses(
  earlier: GroupMembershipResponse,
  later: GroupMembershipResponse
): GroupMembershipResponse {
  const keywordsById = new Map([...earlier.keywords, ...later.keywords].map((keyword) => [keyword.id, keyword]));
  return {
    group_id: later.group_id,
    added: [...earlier.added, ...later.added],
    removed: [...earlier.removed, ...later.removed],
    missing: [...earlier.missing, ...later.missing],
    keywords: [...keywordsById.values()],
  };
}

async function putMembershipChunk(id: string, changes: MembershipChanges): Promise<GroupMembershipResponse> {
  const payload = await apiPut<unknown>(
    `/keyword-groups/${encodeURIComponent(id)}/keywords`,
    changes,
    { allowStructured4xx: true }
  );
  if (!isGroupMembershipResponse(payload)) {
    throw new InvalidKeywordGroupResponseError('Keyword group API returned an invalid membership response');
  }
  return payload;
}

interface MembershipRequest {
  changes: MembershipChanges;
  /** 1 for a chunk's first request, one more for each re-send of its pending ids. */
  round: number;
}

/** The ids of `sent` the server left `pending`, back in the add and remove lists they came from. */
function pendingChanges(sent: MembershipChanges, response: GroupMembershipResponse): MembershipChanges {
  const pending = new Set(response.pending ?? []);
  const add = sent.add?.filter((keywordId) => pending.has(keywordId)) ?? [];
  const remove = sent.remove?.filter((keywordId) => pending.has(keywordId)) ?? [];
  return {
    ...(add.length === 0 ? {} : { add }),
    ...(remove.length === 0 ? {} : { remove }),
  };
}

function incompleteMemberships(pendingCount: number): IncompleteWriteError {
  return new IncompleteWriteError(
    `${pendingCount} keyword membership ${pendingCount === 1 ? 'change was' : 'changes were'} still pending after ${MAX_WRITE_ROUNDS} attempts. Apply the change again to finish.`,
    pendingCount
  );
}

async function putRemainingRequests(
  id: string,
  requests: MembershipRequest[],
  progress: ChunkProgress
): Promise<GroupMembershipResponse> {
  if (requests.length === 0) return progress.applied;
  const [nextRequest, ...laterRequests] = requests;
  const response = await putMembershipChunk(id, nextRequest.changes).catch((failure: unknown) => {
    throw new PartialMembershipUpdateError(progress, failure);
  });
  return continueAfterResponse(id, nextRequest, response, laterRequests, progress);
}

/**
 * Records `response` to `sent`, then sends what is left: the ids the server
 * left pending first (the same chunk's next round), then the later chunks.
 */
function continueAfterResponse(
  id: string,
  sent: MembershipRequest,
  response: GroupMembershipResponse,
  laterRequests: MembershipRequest[],
  progress: ChunkProgress
): Promise<GroupMembershipResponse> {
  const pending = pendingChanges(sent.changes, response);
  const pendingCount = countChanges(pending);
  const advanced: ChunkProgress = {
    applied: mergeMembershipResponses(progress.applied, response),
    appliedChanges: progress.appliedChanges + countChanges(sent.changes) - pendingCount,
    totalChanges: progress.totalChanges,
  };
  if (pendingCount === 0) return putRemainingRequests(id, laterRequests, advanced);
  if (sent.round >= MAX_WRITE_ROUNDS) {
    return Promise.reject(new PartialMembershipUpdateError(advanced, incompleteMemberships(pendingCount)));
  }
  return putRemainingRequests(id, [{
    changes: pending,
    round: sent.round + 1,
  }, ...laterRequests], advanced);
}

/**
 * Applies `changes` in sequential requests of at most
 * `MAX_MEMBERSHIP_CHANGES_PER_REQUEST` ids per list and returns the merged
 * outcome. Ids a response leaves `pending` (the server's time budget ran
 * out) are sent again, at most `MAX_WRITE_ROUNDS` requests per chunk. Stops
 * at the first failed request: a failure of the first request rejects with
 * that request's error; a later failure, or ids still pending after the last
 * round (`IncompleteWriteError`), rejects with `PartialMembershipUpdateError`
 * carrying what was applied.
 */
export async function updateGroupMemberships(
  id: string,
  changes: MembershipChanges
): Promise<GroupMembershipResponse> {
  const [firstChunk, ...laterChunks] = chunkMembershipChanges(changes);
  const firstResponse = await putMembershipChunk(id, firstChunk);
  return continueAfterResponse(
    id,
    {
      changes: firstChunk,
      round: 1,
    },
    firstResponse,
    laterChunks.map((chunk) => ({
      changes: chunk,
      round: 1,
    })),
    {
      applied: {
        group_id: id,
        added: [],
        removed: [],
        missing: [],
        keywords: [],
      },
      appliedChanges: 0,
      totalChanges: countChanges(changes),
    }
  );
}

/** Replace `keywords` entries by id with the freshly returned items. */
export function mergeUpdatedKeywords(keywords: Keyword[], updated: Keyword[]): Keyword[] {
  const byId = new Map(updated.map((keyword) => [keyword.id, keyword]));
  return keywords.map((keyword) => byId.get(keyword.id) ?? keyword);
}
