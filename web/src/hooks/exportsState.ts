/**
 * Pure state steps of the Exports center (`useExports`): merging a refreshed first page into the
 * loaded list, finding the exports that finished between two reads, and the header badge count.
 */
import {
  isExportActive, isUnseenFinish
} from '../api/exports';
import type { ExportSummary } from '../types/domain/exports';

/**
 * The refreshed first page followed by every older export already loaded (from later pages)
 * that the first page does not hold, so polling never drops what "Load more" appended. When the
 * first page is the whole list (`hasMore` false), it is the list.
 */
export function mergeFirstPage(
  loaded: readonly ExportSummary[],
  firstPage: readonly ExportSummary[],
  hasMore: boolean,
): ExportSummary[] {
  if (!hasMore || firstPage.length === 0) return [...firstPage];
  const fresh = new Set(firstPage.map((summary) => summary.export_id));
  const oldestFresh = firstPage[firstPage.length - 1].created_at;
  const older = loaded.filter((summary) => !fresh.has(summary.export_id) && summary.created_at < oldestFresh);
  return [...firstPage, ...older];
}

/** `page` appended after `loaded`, skipping exports already listed. */
export function appendPage(
  loaded: readonly ExportSummary[],
  page: readonly ExportSummary[],
): ExportSummary[] {
  const known = new Set(loaded.map((summary) => summary.export_id));
  return [...loaded, ...page.filter((summary) => !known.has(summary.export_id))];
}

/** The exports that were queued or running in `before` and are ready or failed in `after`. */
export function finishedBetween(
  before: readonly ExportSummary[],
  after: readonly ExportSummary[],
): ExportSummary[] {
  const wasActive = new Set(before.filter(isExportActive).map((summary) => summary.export_id));
  return after.filter((summary) => wasActive.has(summary.export_id)
    && (summary.status === 'ready' || summary.status === 'failed'));
}

/** The header badge: finished exports the owner has not seen. */
export function countUnseen(exports: readonly ExportSummary[]): number {
  return exports.filter(isUnseenFinish).length;
}

/** `exports` with the given ids marked seen. */
export function markedSeen(exports: readonly ExportSummary[], ids: ReadonlySet<string>): ExportSummary[] {
  return exports.map((summary) => (ids.has(summary.export_id) ? {
    ...summary,
    notified: true,
  } : summary));
}
