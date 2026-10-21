/**
 * Runtime guards for the `/brand-mentions` answers: the summary the Brands
 * view and the Keyword Deep Dive read, and one `view=appearances` page.
 */
import type {
  BrandAppearanceRow, BrandAppearancesPage, BrandMentionsResponse
} from '../types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

/** The summary answer: an `aggregated` block with its brand list, and the runs the scope can be read at. */
export function isBrandMentionsResponse(data: unknown): data is BrandMentionsResponse {
  return isRecord(data)
    && isRecord(data.aggregated)
    && Array.isArray(data.aggregated.brands)
    && Array.isArray(data.available_runs);
}

function isAppearanceRow(value: unknown): value is BrandAppearanceRow {
  return isRecord(value)
    && typeof value.brand === 'string'
    && typeof value.classification === 'string'
    && typeof value.keyword === 'string'
    && typeof value.provider === 'string';
}

/** One `view=appearances` page: its rows, their total and the token of the next page. */
export function isBrandAppearancesPage(data: unknown): data is BrandAppearancesPage {
  return isRecord(data)
    && Array.isArray(data.appearances)
    && data.appearances.every(isAppearanceRow)
    && typeof data.total_appearances === 'number'
    && isNullableString(data.next_token);
}
