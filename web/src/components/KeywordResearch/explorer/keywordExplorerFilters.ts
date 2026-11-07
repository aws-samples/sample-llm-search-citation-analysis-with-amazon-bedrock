/**
 * Client-side filters and sort of the Keyword Explorer table.
 *
 * Include terms all must match (split on `,` / `+`), any exclude term drops a row, intent is ANY.
 * A row whose metric is unknown (null) fails every active bound on that metric, so "max difficulty 30"
 * never keeps a Google Ads row without difficulty (null must not compare as 0).
 * Unknown values sort last in both directions, so a descending sort never opens with empty cells.
 */
import type {
  KeywordIntent, KeywordRow
} from '../../../types/api/seo';

export const INTENT_ORDER: readonly KeywordIntent[] = ['informational', 'commercial', 'transactional', 'navigational', 'unknown'];

export interface KeywordFilters {
  /** Every term must appear in the keyword (comma or plus separated). */
  readonly include: string;
  /** No term may appear in the keyword. */
  readonly exclude: string;
  readonly minVolume: string;
  readonly maxVolume: string;
  readonly maxDifficulty: string;
  readonly minCpc: string;
  readonly maxCpc: string;
  /** Empty = every intent. */
  readonly intents: readonly KeywordIntent[];
}

export const EMPTY_FILTERS: KeywordFilters = {
  include: '',
  exclude: '',
  minVolume: '',
  maxVolume: '',
  maxDifficulty: '',
  minCpc: '',
  maxCpc: '',
  intents: [],
};

export type SortField = 'keyword' | 'search_volume' | 'keyword_difficulty' | 'cpc' | 'competition';
export type SortDirection = 'asc' | 'desc';

export interface KeywordSort {
  readonly field: SortField;
  readonly direction: SortDirection;
}

export const DEFAULT_SORT: KeywordSort = {
  field: 'search_volume',
  direction: 'desc',
};

/** The number a bound field holds; null when it is empty or not a number (no bound). */
export function parseBound(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

function splitTerms(text: string): string[] {
  return text.split(/[,+]/).map((term) => term.trim().toLowerCase()).filter(Boolean);
}

/** Whether `value` passes the bounds; an unknown value fails any active bound. */
function withinBounds(value: number | null, min: number | null, max: number | null): boolean {
  if (min === null && max === null) return true;
  if (value === null) return false;
  return (min === null || value >= min) && (max === null || value <= max);
}

interface CompiledFilters {
  include: string[];
  exclude: string[];
  minVolume: number | null;
  maxVolume: number | null;
  maxDifficulty: number | null;
  minCpc: number | null;
  maxCpc: number | null;
  intents: ReadonlySet<KeywordIntent>;
}

function compileFilters(filters: KeywordFilters): CompiledFilters {
  return {
    include: splitTerms(filters.include),
    exclude: splitTerms(filters.exclude),
    minVolume: parseBound(filters.minVolume),
    maxVolume: parseBound(filters.maxVolume),
    maxDifficulty: parseBound(filters.maxDifficulty),
    minCpc: parseBound(filters.minCpc),
    maxCpc: parseBound(filters.maxCpc),
    intents: new Set(filters.intents),
  };
}

function matchesTerms(row: KeywordRow, compiled: CompiledFilters): boolean {
  const text = row.keyword.toLowerCase();
  return compiled.include.every((term) => text.includes(term))
    && !compiled.exclude.some((term) => text.includes(term));
}

function matchesMetrics(row: KeywordRow, compiled: CompiledFilters): boolean {
  return withinBounds(row.search_volume, compiled.minVolume, compiled.maxVolume)
    && withinBounds(row.keyword_difficulty, null, compiled.maxDifficulty)
    && withinBounds(row.cpc, compiled.minCpc, compiled.maxCpc)
    && (compiled.intents.size === 0 || compiled.intents.has(row.intent));
}

export function filterKeywordRows(rows: readonly KeywordRow[], filters: KeywordFilters): KeywordRow[] {
  const compiled = compileFilters(filters);
  return rows.filter((row) => matchesTerms(row, compiled) && matchesMetrics(row, compiled));
}

/** How many filters are active (for the toolbar count). */
export function activeFilterCount(filters: KeywordFilters): number {
  const textFields = [filters.include, filters.exclude].filter((text) => splitTerms(text).length > 0).length;
  const bounds = [filters.minVolume, filters.maxVolume, filters.maxDifficulty, filters.minCpc, filters.maxCpc]
    .filter((text) => parseBound(text) !== null).length;
  return textFields + bounds + (filters.intents.length > 0 ? 1 : 0);
}

function compareKnown(left: KeywordRow, right: KeywordRow, field: SortField): number {
  if (field === 'keyword') return left.keyword.localeCompare(right.keyword);
  const leftValue = left[field];
  const rightValue = right[field];
  if (leftValue === null || rightValue === null) return 0;
  return leftValue - rightValue;
}

function isUnknown(row: KeywordRow, field: SortField): boolean {
  return field !== 'keyword' && row[field] === null;
}

/** `rows` sorted by `sort`; rows without the value come last in either direction. */
export function sortKeywordRows(rows: readonly KeywordRow[], sort: KeywordSort): KeywordRow[] {
  const sign = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((left, right) => {
    const leftUnknown = isUnknown(left, sort.field);
    const rightUnknown = isUnknown(right, sort.field);
    if (leftUnknown !== rightUnknown) return leftUnknown ? 1 : -1;
    return sign * compareKnown(left, right, sort.field);
  });
}

/** The sort after a header click: a new field sorts descending, the same field flips. */
export function nextSort(current: KeywordSort, field: SortField): KeywordSort {
  if (current.field !== field) {
    return {
      field,
      direction: 'desc',
    };
  }
  return {
    field,
    direction: current.direction === 'desc' ? 'asc' : 'desc',
  };
}
