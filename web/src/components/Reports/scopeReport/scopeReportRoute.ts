import type {
  PeriodType, ReportScope
} from '../../../types';
import { ALL_SCOPE } from '../../ui/reportScope';

/**
 * The URL of a scope report: `?keyword=<keyword>` or `?group=<id>` narrows
 * it (every keyword otherwise) and `?days=<n>` picks the trend period, so a
 * shared link or a `?print=1` tab reopens exactly the same report.
 */

/** The trend periods the scope reports offer, in days. */
export const SCOPE_REPORT_PERIODS = [30, 90, 180] as const;

export type ScopeReportDays = (typeof SCOPE_REPORT_PERIODS)[number];

const DEFAULT_SCOPE_REPORT_DAYS: ScopeReportDays = 30;

/** Daily points for a month; weekly ones beyond, so a long trend stays readable. */
export function trendPeriodFor(days: number): PeriodType {
  return days > DEFAULT_SCOPE_REPORT_DAYS ? 'week' : 'day';
}

/** The scope in the URL: a keyword wins over a group; neither means every keyword. */
export function scopeFromSearch(search: URLSearchParams): ReportScope {
  const keyword = search.get('keyword');
  if (keyword) {
    return {
      kind: 'keyword',
      keyword,
    };
  }
  const groupId = search.get('group');
  if (groupId) {
    return {
      kind: 'group',
      groupId,
    };
  }
  return ALL_SCOPE;
}

function isScopeReportDays(value: number): value is ScopeReportDays {
  return SCOPE_REPORT_PERIODS.some((days) => days === value);
}

/** The trend period in the URL, or the default for a missing or unoffered one. */
export function daysFromSearch(search: URLSearchParams): ScopeReportDays {
  const days = Number(search.get('days'));
  return isScopeReportDays(days) ? days : DEFAULT_SCOPE_REPORT_DAYS;
}

/** The path of the report at `basePath` for `scope` over `days`; the defaults stay out of the URL. */
export function scopeReportPath(basePath: string, scope: ReportScope, days: ScopeReportDays): string {
  const search = new URLSearchParams();
  if (scope.kind === 'keyword') search.set('keyword', scope.keyword);
  if (scope.kind === 'group') search.set('group', scope.groupId);
  if (days !== DEFAULT_SCOPE_REPORT_DAYS) search.set('days', String(days));
  const query = search.toString();
  return query === '' ? basePath : `${basePath}?${query}`;
}
