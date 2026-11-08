/**
 * Runtime guards for the `/brand-mentions` answers: the summary the Brands
 * view and the Keyword Deep Dive read, and one `view=appearances` page.
 */
import type {
  AggregatedBrand, BrandAppearanceRow, BrandAppearancesPage, BrandMentionsResponse
} from '../types';
import {
  isNullableString, isRecord
} from '../types/domain/keywordDecoders';

/** The summary answer: an `aggregated` block with its brand list, and the runs the scope can be read at. */
export function isBrandMentionsResponse(data: unknown): data is BrandMentionsResponse {
  return isRecord(data)
    && isRecord(data.aggregated)
    && Array.isArray(data.aggregated.brands)
    && Array.isArray(data.available_runs);
}

/** One brand of the summary's `aggregated.brands` (a `view=brands` page holds the same rows). */
export function isAggregatedBrand(value: unknown): value is AggregatedBrand {
  return isRecord(value)
    && typeof value.name === 'string'
    && typeof value.classification === 'string'
    && typeof value.aggregate_score === 'number'
    && Array.isArray(value.providers);
}

/** One row of a `view=appearances` page. */
export function isAppearanceRow(value: unknown): value is BrandAppearanceRow {
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
