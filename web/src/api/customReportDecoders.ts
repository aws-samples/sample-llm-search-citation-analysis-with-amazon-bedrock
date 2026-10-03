/**
 * Runtime guards for the custom reports API (`/custom-reports`).
 *
 * This module owns the wire shape of a saved report. Blocks are only checked
 * for a string `type` and kept whole: data blocks are identified by their type
 * alone, and the fields of content blocks are checked by the content block
 * guards (`components/Reports/customReport/content/contentBlocks.ts`).
 */
import { isRecord } from '../types/domain/keywordDecoders';

/** Periods a custom report can cover, in days; mirrors `REPORT_DAYS` in `lambda/api/manage-custom-reports.py`. */
export const CUSTOM_REPORT_DAYS = [30, 90, 180] as const;

export type CustomReportDays = typeof CUSTOM_REPORT_DAYS[number];

/**
 * One block of a custom report. `type` names the block; every other field is
 * kept as the server sent it.
 */
export type ReportBlock = { readonly type: string } & Readonly<Record<string, unknown>>;

export interface CustomReport {
  readonly id: string;
  readonly title: string;
  readonly blocks: readonly ReportBlock[];
  readonly days: CustomReportDays;
  readonly created_at: string;
  readonly created_by: string;
  readonly updated_at: string;
  readonly updated_by: string;
}

/** Response from GET /custom-reports, newest updated first. */
interface CustomReportsResponse {readonly reports: readonly CustomReport[];}

/** Response from POST /custom-reports and PUT /custom-reports/{id}. */
interface CustomReportResponse {readonly report: CustomReport;}

const REPORT_STRING_FIELDS = ['id', 'title', 'created_at', 'created_by', 'updated_at', 'updated_by'] as const;

function isCustomReportDays(value: unknown): value is CustomReportDays {
  return CUSTOM_REPORT_DAYS.some((days) => days === value);
}

function isReportBlock(value: unknown): value is ReportBlock {
  return isRecord(value) && typeof value.type === 'string';
}

export function isCustomReport(value: unknown): value is CustomReport {
  return (
    isRecord(value)
    && REPORT_STRING_FIELDS.every((field) => typeof value[field] === 'string')
    && isCustomReportDays(value.days)
    && Array.isArray(value.blocks)
    && value.blocks.every(isReportBlock)
  );
}

export function isCustomReportsResponse(value: unknown): value is CustomReportsResponse {
  return isRecord(value) && Array.isArray(value.reports) && value.reports.every(isCustomReport);
}

export function isCustomReportResponse(value: unknown): value is CustomReportResponse {
  return isRecord(value) && isCustomReport(value.report);
}
