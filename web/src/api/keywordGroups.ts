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
} from '../types/domain/keywordDecoders';
import type { GroupMembershipResponse } from '../types/domain/keywordDecoders';

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

export async function deleteKeywordGroup(id: string): Promise<void> {
  await apiDelete<unknown>(`/keyword-groups/${encodeURIComponent(id)}`, { allowStructured4xx: true });
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

async function putRemainingChunks(
  id: string,
  chunks: MembershipChanges[],
  progress: ChunkProgress
): Promise<GroupMembershipResponse> {
  if (chunks.length === 0) return progress.applied;
  const [nextChunk, ...laterChunks] = chunks;
  const response = await putMembershipChunk(id, nextChunk).catch((failure: unknown) => {
    throw new PartialMembershipUpdateError(progress, failure);
  });
  return putRemainingChunks(id, laterChunks, {
    applied: mergeMembershipResponses(progress.applied, response),
    appliedChanges: progress.appliedChanges + countChanges(nextChunk),
    totalChanges: progress.totalChanges,
  });
}

/**
 * Applies `changes` in sequential requests of at most
 * `MAX_MEMBERSHIP_CHANGES_PER_REQUEST` ids per list and returns the merged
 * outcome. Stops at the first failed request: a failure of the first request
 * rejects with that request's error; a later failure rejects with
 * `PartialMembershipUpdateError` carrying what was applied.
 */
export async function updateGroupMemberships(
  id: string,
  changes: MembershipChanges
): Promise<GroupMembershipResponse> {
  const [firstChunk, ...laterChunks] = chunkMembershipChanges(changes);
  const firstResponse = await putMembershipChunk(id, firstChunk);
  return putRemainingChunks(id, laterChunks, {
    applied: firstResponse,
    appliedChanges: countChanges(firstChunk),
    totalChanges: countChanges(changes),
  });
}

/** Replace `keywords` entries by id with the freshly returned items. */
export function mergeUpdatedKeywords(keywords: Keyword[], updated: Keyword[]): Keyword[] {
  const byId = new Map(updated.map((keyword) => [keyword.id, keyword]));
  return keywords.map((keyword) => byId.get(keyword.id) ?? keyword);
}
