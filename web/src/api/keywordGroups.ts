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

export async function updateGroupMemberships(
  id: string,
  changes: MembershipChanges
): Promise<GroupMembershipResponse> {
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

/** Replace `keywords` entries by id with the freshly returned items. */
export function mergeUpdatedKeywords(keywords: Keyword[], updated: Keyword[]): Keyword[] {
  const byId = new Map(updated.map((keyword) => [keyword.id, keyword]));
  return keywords.map((keyword) => byId.get(keyword.id) ?? keyword);
}
