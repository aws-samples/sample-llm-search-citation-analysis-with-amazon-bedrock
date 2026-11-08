/**
 * The export service (2.45.0): every data view's "Export all" posts the view id and its
 * on-screen query parameters to `POST /api/exports`; a Step Functions job writes the whole file
 * (no time limit, never a partial file) and the Exports page downloads it once `ready`. A
 * download URL is a 15-minute presigned GET minted on each `GET /api/exports/{id}`, so the
 * dashboard asks for a fresh one on every click and never stores it.
 */
import { ApiRequestError } from '../infrastructure';
import type {
  ExportFormat, ExportStatus, ExportSummary, ExportView, ExportsListResponse
} from '../types/domain/exports';
import {
  isExportSummary, isExportsListResponse
} from '../types/domain/exportsDecoders';
import { isRecord } from '../types/domain/keywordDecoders';
import {
  apiDelete, apiGet, apiPost
} from './client';

/** What a view's "Export all" asks for. */
export interface ExportRequest {
  readonly view: ExportView;
  readonly params: Readonly<Record<string, string>>;
  readonly format: ExportFormat;
}

/** A view's query parameters as its button receives them: unset filters are `null`/`undefined`/`''`. */
export type ViewParams = Readonly<Record<string, string | number | boolean | null | undefined>>;

const PAGING_PARAMS: ReadonlySet<string> = new Set(['limit', 'offset', 'next_token']);

function isPagingParam(name: string): boolean {
  return PAGING_PARAMS.has(name) || name.endsWith('_next_token');
}

/**
 * The export `params` of a view's query: every set filter as a string, without the paging
 * parameters (`limit`, `offset`, `next_token`, `<list>_next_token`), keys sorted so the same
 * filters always give the same request.
 */
export function exportParams(params: ViewParams): Record<string, string> {
  const entries = Object.entries(params)
    .filter(([name, value]) => !isPagingParam(name) && value !== null && value !== undefined && value !== '')
    .map(([name, value]) => [name, String(value)] as const)
    .sort(([a], [b]) => a.localeCompare(b));
  return Object.fromEntries(entries);
}

/** The query of a view's own GET (`useScopedList` requests) as export params; `null` until it is made. */
export function requestParams(request: { readonly params?: URLSearchParams } | null | undefined): Record<string, string> | null {
  if (request === null || request === undefined) return null;
  return exportParams(Object.fromEntries(new URLSearchParams(request.params ?? '').entries()));
}

const ACTIVE_STATUSES: ReadonlySet<ExportStatus> = new Set(['queued', 'running']);

/** The job is still writing the file. */
export function isExportActive(summary: ExportSummary): boolean {
  return ACTIVE_STATUSES.has(summary.status);
}

/** Finished (ready or failed) and the owner has not seen it yet: what the header badge counts. */
export function isUnseenFinish(summary: ExportSummary): boolean {
  return (summary.status === 'ready' || summary.status === 'failed') && !summary.notified;
}

function decodeExportEnvelope(payload: unknown): ExportSummary {
  if (!isRecord(payload) || !isExportSummary(payload.export)) {
    throw new ApiRequestError('The export answer is not an export');
  }
  return payload.export;
}

/** `POST /api/exports`: starts the export; the answer is the queued job. */
export async function startExport(request: ExportRequest, signal?: AbortSignal): Promise<ExportSummary> {
  const payload = await apiPost<unknown>('/exports', {
    view: request.view,
    params: request.params,
    format: request.format,
  }, {
    signal,
    allowStructured4xx: true,
  });
  return decodeExportEnvelope(payload);
}

/** `GET /api/exports`: one page of the caller's exports, newest first. */
export async function listExports(nextToken: string | null, signal?: AbortSignal): Promise<ExportsListResponse> {
  const payload = await apiGet<unknown>('/exports', {
    params: nextToken === null ? undefined : { next_token: nextToken },
    signal,
    retry: false,
  });
  if (!isExportsListResponse(payload)) throw new ApiRequestError('The exports list answer is malformed');
  return payload;
}

/** `GET /api/exports/{id}`: the export, with a fresh `download_url` when it is ready. */
export async function getExport(exportId: string, signal?: AbortSignal): Promise<ExportSummary> {
  const payload = await apiGet<unknown>(`/exports/${encodeURIComponent(exportId)}`, { signal });
  return decodeExportEnvelope(payload);
}

/** The presigned URL of a ready export, read fresh; only an `https:` URL is ever followed. */
export async function fetchDownloadUrl(exportId: string): Promise<string> {
  const summary = await getExport(exportId);
  const url = summary.download_url;
  if (summary.status !== 'ready' || url === undefined || !isHttpsUrl(url)) {
    throw new ApiRequestError('The export has no download link yet');
  }
  return url;
}

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** `DELETE /api/exports/{id}`: cancels a running export or deletes a finished one (204). */
export async function deleteExport(exportId: string): Promise<void> {
  await apiDelete<unknown>(`/exports/${encodeURIComponent(exportId)}`, { allowStructured4xx: true });
}

/** `POST /api/exports/{id}/seen`: the owner has seen that it finished (clears its badge count). */
export async function markExportSeen(exportId: string): Promise<void> {
  await apiPost<unknown>(`/exports/${encodeURIComponent(exportId)}/seen`, {});
}
