/**
 * Runtime guards for the export service contract (`exports.ts`).
 *
 * `@public` marks contract exports the dashboard does not read yet (track T3
 * wires them into `api/exports.ts`); knip skips them until then.
 */
import { EXPORT_VIEWS } from './exports';
import type {
  ExportFormat, ExportStatus, ExportsListResponse, ExportSummary
} from './exports';
import { isRecord } from './keywordDecoders';

const VIEWS: ReadonlySet<unknown> = new Set<string>(EXPORT_VIEWS);
const FORMATS: ReadonlySet<unknown> = new Set<ExportFormat>(['csv', 'xlsx']);
const STATUSES: ReadonlySet<unknown> = new Set<ExportStatus>(['queued', 'running', 'ready', 'failed', 'cancelled']);

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every((entry) => typeof entry === 'string');
}

function hasExportIdentity(value: Record<string, unknown>): boolean {
  return typeof value.export_id === 'string'
    && VIEWS.has(value.view)
    && isStringRecord(value.params)
    && FORMATS.has(value.format)
    && STATUSES.has(value.status)
    && typeof value.filename === 'string';
}

function hasExportProgress(value: Record<string, unknown>): boolean {
  return typeof value.created_at === 'string'
    && typeof value.updated_at === 'string'
    && isCount(value.rows)
    && isCount(value.truncated_cells)
    && isCount(value.bytes)
    && typeof value.notified === 'boolean';
}

/**
 * Every required field well-typed; `error`, `download_url` and `download_expires_at` absent or strings.
 * @public
 */
export function isExportSummary(value: unknown): value is ExportSummary {
  return isRecord(value)
    && hasExportIdentity(value)
    && hasExportProgress(value)
    && isOptionalString(value.error)
    && isOptionalString(value.download_url)
    && isOptionalString(value.download_expires_at);
}

/**
 * `{exports, next_token}`; `next_token` may be absent or `null` on the last page.
 * @public
 */
export function isExportsListResponse(value: unknown): value is ExportsListResponse {
  return isRecord(value)
    && Array.isArray(value.exports)
    && value.exports.every(isExportSummary)
    && (value.next_token === undefined || value.next_token === null || typeof value.next_token === 'string');
}
