/**
 * Runtime decoders for keyword API payloads (bugs.md 4.1).
 *
 * Previously `isKeywordStatus` was byte-identical in `useDashboardData` and
 * `KeywordsManager`, which also validated the same `Keyword` shape in two
 * styles (`isKeyword` vs `isKeywordResponse`). This module is the single
 * home; `isRecord` is the shared object-ness guard other decoders can build
 * on. (Zod would subsume these, but it is not a web dependency — adopting it
 * is a deliberate decision, not a drive-by.)
 */
import type {
  Keyword, KeywordGroup 
} from './baseTypes';

/** Shared record guard: a non-null object that is not an array. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function isKeywordStatus(value: unknown): value is Keyword['status'] {
  return value === undefined || value === 'active' || value === 'inactive' || value === 'paused';
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

export function isKeyword(value: unknown): value is Keyword {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.keyword === 'string'
    && typeof value.created_at === 'string'
    && isKeywordStatus(value.status)
    && (value.group_ids === undefined || isStringArray(value.group_ids))
  );
}

export function isKeywordGroup(value: unknown): value is KeywordGroup {
  return (
    isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.description === 'string'
    && typeof value.keyword_count === 'number'
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
  );
}

/** Response from GET /keyword-groups. */
export interface KeywordGroupsResponse {
  groups: KeywordGroup[];
  count: number 
}

export function isKeywordGroupsResponse(value: unknown): value is KeywordGroupsResponse {
  return (
    isRecord(value)
    && Array.isArray(value.groups)
    && value.groups.every(isKeywordGroup)
    && typeof value.count === 'number'
  );
}

/** Response from PUT /keyword-groups/{id}/keywords. */
export interface GroupMembershipResponse {
  group_id: string;
  added: string[];
  removed: string[];
  missing: string[];
  keywords: Keyword[];
}

export function isGroupMembershipResponse(value: unknown): value is GroupMembershipResponse {
  return (
    isRecord(value)
    && typeof value.group_id === 'string'
    && isStringArray(value.added)
    && isStringArray(value.removed)
    && isStringArray(value.missing)
    && Array.isArray(value.keywords)
    && value.keywords.every(isKeyword)
  );
}

/** Response from the ordinary keywords API. */
export interface KeywordsResponse { keywords: Keyword[] }

/** Complete response from the authoritative keywords API. */
export interface AuthoritativeKeywordsResponse {
  keywords: Keyword[];
  count: number;
  complete: true;
}

export function isKeywordsResponse(value: unknown): value is KeywordsResponse {
  return (
    isRecord(value)
    && Array.isArray(value.keywords)
    && value.keywords.every(isKeyword)
  );
}

export function isAuthoritativeKeywordsResponse(value: unknown): value is AuthoritativeKeywordsResponse {
  return (
    isKeywordsResponse(value)
    && 'count' in value
    && typeof value.count === 'number'
    && Number.isInteger(value.count)
    && value.count === value.keywords.length
    && 'complete' in value
    && value.complete === true
  );
}
