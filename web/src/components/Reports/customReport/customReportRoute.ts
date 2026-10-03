import {
  CUSTOM_REPORT_DAYS, type CustomReportDays
} from '../../../api/customReports';
import type { ReportScope } from '../../../types';

/**
 * The URLs of custom reports. A saved report opens at
 * `/reports/custom/<id>`; `?keyword=` or `?group=` narrows it, `?days=`
 * overrides its saved period and `?competitor=` picks the competitor its
 * Competitor Gap blocks show, so a shared link or a `?print=1` tab reopens
 * exactly the same view.
 */

export const NEW_CUSTOM_REPORT_PATH = '/reports/custom/new';

export function customReportPath(id: string): string {
  return `/reports/custom/${encodeURIComponent(id)}`;
}

export function customReportEditPath(id: string): string {
  return `${customReportPath(id)}/edit`;
}

export interface ReportViewSettings {
  readonly scope: ReportScope;
  readonly days: CustomReportDays;
  readonly competitor: string | null;
}

/** The URL of report `id` showing `view`; the saved period stays out of it. */
export function customReportViewPath(id: string, savedDays: CustomReportDays, view: ReportViewSettings): string {
  const search = new URLSearchParams();
  if (view.scope.kind === 'keyword') search.set('keyword', view.scope.keyword);
  if (view.scope.kind === 'group') search.set('group', view.scope.groupId);
  if (view.days !== savedDays) search.set('days', String(view.days));
  if (view.competitor !== null) search.set('competitor', view.competitor);
  const query = search.toString();
  return query === '' ? customReportPath(id) : `${customReportPath(id)}?${query}`;
}

function isCustomReportDays(value: number): value is CustomReportDays {
  return CUSTOM_REPORT_DAYS.some((days) => days === value);
}

/** The period in the URL, or the report's saved one for a missing or unoffered value. */
export function customReportDays(search: URLSearchParams, savedDays: CustomReportDays): CustomReportDays {
  const days = Number(search.get('days'));
  return isCustomReportDays(days) ? days : savedDays;
}
