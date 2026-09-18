import type { ReportScope } from '../../types';

/** The scope that narrows a report to one keyword. */
export function keywordScope(keyword: string): ReportScope {
  return {
    kind: 'keyword',
    keyword,
  };
}

/** The scope that narrows a report to one keyword group. */
export function groupScope(groupId: string): ReportScope {
  return {
    kind: 'group',
    groupId,
  };
}
