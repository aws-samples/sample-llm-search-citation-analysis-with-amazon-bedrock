import type {
  PeriodType, ReportScope
} from '../../../types';
import { ALL_SCOPE } from '../../ui/reportScope';
import { MARKET_SEARCH_PARAM } from '../../Markets/marketSelection';

/**
 * The URL of a scope report: `?keyword=<keyword>` or `?group=<id>` narrows
 * it (every keyword otherwise), `?days=<n>` picks the trend period and
 * `?market=<id>` the market, so a shared link or a `?print=1` tab reopens
 * exactly the same report.
 */

/** The trend periods the scope reports offer, in days. */
export const SCOPE_REPORT_PERIODS = [30, 90, 180] as const;

export type ScopeReportDays = (typeof SCOPE_REPORT_PERIODS)[number];

const DEFAULT_SCOPE_REPORT_DAYS: ScopeReportDays = 30;

/** Daily points for a month; weekly ones beyond, so a long trend stays readable. */
export function trendPeriodFor(days: number): PeriodType {
  return days > DEFAULT_SCOPE_REPORT_DAYS ? 'week' : 'day';
}

/**
 * The scope in the URL: a keyword wins over a group; neither means every
 * keyword. A route that carries the keyword outside the query (the path
 * parameter of `/reports/visibility/:keyword`) passes it as `keyword`,
 * `null` when it has none; `?keyword=` is read only when it passes nothing.
 */
export function scopeFromSearch(search: URLSearchParams, keyword: string | null = search.get('keyword')): ReportScope {
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

/**
 * `path` with `search` as its query, the market (the `?market=` value on
 * screen) added so changing a report view does not drop the market a shared
 * link names; no `?` when the query is empty.
 */
export function reportPathWithQuery(path: string, search: URLSearchParams, market: string | null): string {
  if (market !== null) search.set(MARKET_SEARCH_PARAM, market);
  const query = search.toString();
  return query === '' ? path : `${path}?${query}`;
}

/** The path of the report at `basePath` for `scope` over `days`; the defaults stay out of the URL. */
export function scopeReportPath(basePath: string, scope: ReportScope, days: ScopeReportDays, market: string | null = null): string {
  const search = new URLSearchParams();
  if (scope.kind === 'keyword') search.set('keyword', scope.keyword);
  if (scope.kind === 'group') search.set('group', scope.groupId);
  if (days !== DEFAULT_SCOPE_REPORT_DAYS) search.set('days', String(days));
  return reportPathWithQuery(basePath, search, market);
}
