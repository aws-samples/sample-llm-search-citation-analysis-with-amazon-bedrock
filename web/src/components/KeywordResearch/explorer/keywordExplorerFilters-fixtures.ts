/**
 * The Keyword Explorer filter and sort cases shared with the export route (`lambda/seo/seo-keywords.py`
 * `explorer_rows`, `lambda/testing/keyword_explorer_filter_cases.json`), typed for the dashboard's rules: the
 * table and its server export must list the same rows in the same order.
 */
import sharedCases from '../../../../../lambda/testing/keyword_explorer_filter_cases.json';
import { buildKeywordRow } from '../../../api/seo-fixtures';
import { isKeywordIntent } from '../../../api/seoDecoders';
import type { KeywordRow } from '../../../types/api/seo';
import {
  EMPTY_FILTERS, type KeywordFilters, type KeywordSort, type SortField
} from './keywordExplorerFilters';

interface SharedFilterCase {
  readonly name: string;
  readonly filters: KeywordFilters;
  readonly sort: KeywordSort;
  /** The keywords the table lists, in order. */
  readonly keywords: readonly string[];
}

const SORT_FIELDS: readonly SortField[] = ['keyword', 'search_volume', 'keyword_difficulty', 'cpc', 'competition'];
const TEXT_FILTERS = ['include', 'exclude', 'minVolume', 'maxVolume', 'maxDifficulty', 'minCpc', 'maxCpc'] as const;

function sortOf(sort: {
  readonly field: string;
  readonly direction: string 
}): KeywordSort {
  const field = SORT_FIELDS.find((candidate) => candidate === sort.field);
  if (field === undefined) throw new RangeError(`Unknown sort field ${sort.field}`);
  return {
    field,
    direction: sort.direction === 'asc' ? 'asc' : 'desc',
  };
}

function filtersOf(raw: Readonly<Record<string, unknown>>): KeywordFilters {
  const texts = Object.fromEntries(TEXT_FILTERS.map((name) => {
    const value = raw[name];
    return [name, typeof value === 'string' ? value : ''];
  }));
  const intents = Array.isArray(raw.intents) ? raw.intents.filter(isKeywordIntent) : [];
  return {
    ...EMPTY_FILTERS,
    ...texts,
    intents,
  };
}

/** The research rows every shared case filters. */
export const SHARED_FILTER_ROWS: readonly KeywordRow[] = sharedCases.rows.map((row) => buildKeywordRow({
  ...row,
  intent: isKeywordIntent(row.intent) ? row.intent : 'unknown',
}));

export const SHARED_FILTER_CASES: readonly SharedFilterCase[] = sharedCases.cases.map((entry) => ({
  name: entry.name,
  filters: filtersOf(entry.filters),
  sort: sortOf(entry.sort),
  keywords: entry.keywords,
}));
