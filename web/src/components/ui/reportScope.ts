import type {
  Keyword, KeywordGroup, ReportScope
} from '../../types';

/**
 * Pure helpers for the report scope selector: encoding a scope as a
 * `<select>` value and back, the query parameters the read endpoints expect,
 * and display copy.
 */

export const ALL_SCOPE: ReportScope = { kind: 'all' };

export function encodeReportScope(scope: ReportScope): string {
  if (scope.kind === 'group') return `group:${scope.groupId}`;
  if (scope.kind === 'keyword') return `keyword:${scope.keyword}`;
  return 'all';
}

export function decodeReportScope(value: string): ReportScope {
  if (value.startsWith('group:')) return {
    kind: 'group',
    groupId: value.slice('group:'.length) 
  };
  if (value.startsWith('keyword:')) return {
    kind: 'keyword',
    keyword: value.slice('keyword:'.length) 
  };
  return ALL_SCOPE;
}

/**
 * Query parameters for the read endpoints. Endpoints whose default already
 * covers every keyword (trends, gaps, citations, overview) get `scope=all`
 * for an explicit group-style answer, which is also what `/visibility` and
 * `/brand-mentions` need since they have no keyword-less default.
 */
export function reportScopeParams(scope: ReportScope): Record<string, string> {
  if (scope.kind === 'group') return { group_id: scope.groupId };
  if (scope.kind === 'keyword') return { keyword: scope.keyword };
  return { scope: 'all' };
}

export function describeReportScope(scope: ReportScope, groups: KeywordGroup[]): string {
  if (scope.kind === 'group') return groups.find((group) => group.id === scope.groupId)?.name ?? 'Deleted group';
  if (scope.kind === 'keyword') return scope.keyword;
  return 'All keywords';
}

/** Whether the scope still points at something that exists. */
export function isReportScopeAvailable(scope: ReportScope, keywords: Keyword[], groups: KeywordGroup[]): boolean {
  if (scope.kind === 'group') return groups.some((group) => group.id === scope.groupId);
  if (scope.kind === 'keyword') return keywords.some((keyword) => keyword.keyword === scope.keyword);
  return true;
}

export function reportScopesEqual(left: ReportScope, right: ReportScope): boolean {
  return encodeReportScope(left) === encodeReportScope(right);
}
