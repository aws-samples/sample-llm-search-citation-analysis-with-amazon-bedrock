/**
 * Custom reports API client.
 *
 * A custom report is a title, a period and an ordered list of blocks: data
 * blocks (existing report sections, identified by their `type` alone) and
 * content blocks (headings, text, images, videos) that carry their own
 * content. Writes pass `allowStructured4xx` so a rejected save surfaces the
 * server's `{error, field}` on the `ApiRequestError`.
 */
import {
  apiDelete, apiGet, apiPost, apiPut
} from './client';
import {
  isCustomReportResponse, isCustomReportsResponse
} from './customReportDecoders';
import type {
  CustomReport, CustomReportDays, ReportBlock
} from './customReportDecoders';

export { CUSTOM_REPORT_DAYS } from './customReportDecoders';
export type {
  CustomReport, CustomReportDays, ReportBlock
} from './customReportDecoders';

/** The period a new report starts with; mirrors `DEFAULT_REPORT_DAYS` in `lambda/api/manage-custom-reports.py`. */
export const DEFAULT_CUSTOM_REPORT_DAYS: CustomReportDays = 90;

/**
 * Most reports that can be saved; mirrors `MAX_CUSTOM_REPORTS` in
 * `lambda/api/manage-custom-reports.py`, which answers a create beyond it
 * with 409 `{error: 'limit_reached', field: 'reports'}`.
 */
export const MAX_CUSTOM_REPORTS = 50;

/**
 * Most blocks one report may hold; mirrors `MAX_BLOCKS` in
 * `lambda/api/manage-custom-reports.py`, which rejects a longer list (and an
 * empty one) with a 400 on `blocks`.
 */
export const MAX_REPORT_BLOCKS = 30;

/**
 * Longest report title in characters; mirrors `MAX_TITLE_LENGTH` in
 * `lambda/api/manage-custom-reports.py`, which rejects a longer (or empty)
 * title with a 400 on `title`.
 */
export const MAX_REPORT_TITLE_LENGTH = 80;

/** What a create or an update sends. */
export interface CustomReportInput {
  readonly title: string;
  readonly blocks: readonly ReportBlock[];
  readonly days: CustomReportDays;
}

export class InvalidCustomReportResponseError extends TypeError {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidCustomReportResponseError';
  }
}

function decodeReport(payload: unknown): CustomReport {
  if (!isCustomReportResponse(payload)) {
    throw new InvalidCustomReportResponseError('Custom report API returned an invalid report');
  }
  return payload.report;
}

/** Only the fields the server accepts, so a caller passing a whole report sends no extra keys. */
function requestBody({
  title, blocks, days
}: CustomReportInput): CustomReportInput {
  return {
    title,
    blocks,
    days,
  };
}

function reportPath(id: string): string {
  return `/custom-reports/${encodeURIComponent(id)}`;
}

/** Saved reports, newest updated first. */
export async function fetchCustomReports(signal?: AbortSignal): Promise<readonly CustomReport[]> {
  const payload = await apiGet<unknown>('/custom-reports', { signal });
  if (!isCustomReportsResponse(payload)) {
    throw new InvalidCustomReportResponseError('Custom report API returned an invalid list');
  }
  return payload.reports;
}

export async function createCustomReport(input: CustomReportInput): Promise<CustomReport> {
  return decodeReport(await apiPost<unknown>('/custom-reports', requestBody(input), { allowStructured4xx: true }));
}

export async function updateCustomReport(id: string, input: CustomReportInput): Promise<CustomReport> {
  return decodeReport(await apiPut<unknown>(reportPath(id), requestBody(input), { allowStructured4xx: true }));
}

export async function deleteCustomReport(id: string): Promise<void> {
  await apiDelete<unknown>(reportPath(id), { allowStructured4xx: true });
}
