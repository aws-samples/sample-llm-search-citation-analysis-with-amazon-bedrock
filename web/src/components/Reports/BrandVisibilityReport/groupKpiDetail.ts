/**
 * The per-keyword runs and per-run drivers of `GET /reports/group-kpis`,
 * which the summary leaves out so it stays small however many keywords and
 * runs a group has. The Excel export needs all of them: it follows the
 * `view=keywords` pages, and reads the drivers in slices of compared group
 * runs (`view=drivers` with `from_run` / `to_run`), a few slices at a time,
 * so each request reads only its part of the window.
 */
import { apiGet } from '../../../api/client';
import {
  collectCursorPages, withNextToken, type CursorPage
} from '../../../api/cursorPages';
import type { ReportScope } from '../../../types';
import {
  isGroupKeywordRunsPage, isGroupRunDriversPage, type GroupRun, type GroupRunDrivers, type KeywordRunHistory
} from '../../../types/domain/groupKpiHistory';
import { reportScopeParams } from '../../ui/reportScope';

/** Compared group runs one `view=drivers` request covers. */
export const DRIVER_RUNS_PER_REQUEST = 10;

/** `view=drivers` requests in flight at once during an export. */
export const DRIVER_REQUESTS_IN_PARALLEL = 3;

/** The group KPI API answered with something other than a well-formed page. */
export class GroupKpiDetailError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GroupKpiDetailError';
  }
}

/** The group the detail is read for, in the header's market. */
export interface GroupKpiDetailTarget {
  readonly scope: ReportScope;
  readonly marketId: string | null;
}

/** Every keyword's runs and every compared run's drivers: what the export adds to the summary. */
export interface GroupKpiDetail {
  readonly keywords: readonly KeywordRunHistory[];
  readonly drivers: readonly GroupRunDrivers[];
}

async function fetchKeywordRunsPage(
  target: GroupKpiDetailTarget, days: number, nextToken: string | null,
): Promise<CursorPage<KeywordRunHistory>> {
  const payload = await apiGet<unknown>('/reports/group-kpis', {
    params: withNextToken({
      ...reportScopeParams(target.scope, target.marketId),
      days: days.toString(),
      view: 'keywords',
    }, nextToken),
  });
  if (!isGroupKeywordRunsPage(payload)) throw new GroupKpiDetailError('Group KPI API returned an invalid keyword page');
  return {
    items: payload.keywords,
    nextToken: payload.next_token,
  };
}

async function fetchDriversPage(
  target: GroupKpiDetailTarget, fromRun: string, toRun: string, nextToken: string | null,
): Promise<CursorPage<GroupRunDrivers>> {
  const payload = await apiGet<unknown>('/reports/group-kpis', {
    params: withNextToken({
      ...reportScopeParams(target.scope, target.marketId),
      view: 'drivers',
      from_run: fromRun,
      to_run: toRun,
    }, nextToken),
  });
  if (!isGroupRunDriversPage(payload)) throw new GroupKpiDetailError('Group KPI API returned an invalid drivers page');
  return {
    items: payload.changes,
    nextToken: payload.next_token,
  };
}

/** Every keyword's runs in the last `days` days, in the group's keyword order. */
export async function fetchAllKeywordRuns(target: GroupKpiDetailTarget, days: number): Promise<KeywordRunHistory[]> {
  return collectCursorPages(
    async (nextToken: string | null) => fetchKeywordRunsPage(target, days, nextToken),
    () => new GroupKpiDetailError('Group KPI API repeated a continuation token'),
  );
}

/** The drivers of the compared group runs after `fromRun` (a group run) through `toRun`, oldest first. */
export async function fetchRunDrivers(target: GroupKpiDetailTarget, fromRun: string, toRun: string): Promise<GroupRunDrivers[]> {
  return collectCursorPages(
    async (nextToken: string | null) => fetchDriversPage(target, fromRun, toRun, nextToken),
    () => new GroupKpiDetailError('Group KPI API repeated a continuation token'),
  );
}

/** `items` cut into consecutive slices of `size`. */
export function slices<T>(items: readonly T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_unused, index) => items.slice(index * size, (index + 1) * size));
}

/** `load` over every item, at most `limit` at a time; the results keep the items' order. */
export async function mapInBatches<T, R>(items: readonly T[], limit: number, load: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const batch of slices(items, limit)) {
    results.push(...await Promise.all(batch.map(load)));
  }
  return results;
}

/** The drivers of every compared group run of `runs`, oldest first, read slice by slice. */
export async function fetchAllRunDrivers(target: GroupKpiDetailTarget, runs: readonly GroupRun[]): Promise<GroupRunDrivers[]> {
  const compared = runs.filter((run) => run.change !== null);
  const pages = await mapInBatches(slices(compared, DRIVER_RUNS_PER_REQUEST), DRIVER_REQUESTS_IN_PARALLEL, async (slice) => fetchRunDrivers(
    target, slice[0].change?.previous_timestamp ?? slice[0].timestamp, slice[slice.length - 1].timestamp,
  ));
  return pages.flat();
}

/** Every keyword's runs and every compared run's drivers of the group's summary `runs` over `days` days. */
export async function fetchGroupKpiDetail(target: GroupKpiDetailTarget, days: number, runs: readonly GroupRun[]): Promise<GroupKpiDetail> {
  const [keywords, drivers] = await Promise.all([fetchAllKeywordRuns(target, days), fetchAllRunDrivers(target, runs)]);
  return {
    keywords,
    drivers,
  };
}
