/**
 * Domain Overview filter forms: what the user typed, as the request's
 * `filters`, and how many of DataForSEO's 8 filter conditions it uses.
 *
 * The count mirrors the server (`lambda/shared/dataforseo_domain_scope.py`):
 * every include or exclude term is one condition, every set bound one, the
 * keyword search two (keyword or URL), the page search one, and a narrow
 * scope uses its own slots. Over the budget the server refuses the request
 * rather than dropping conditions, so Apply is disabled instead.
 */
import type {
  DomainKeywordFilters, DomainPageFilters, DomainScope
} from '../../../types/api/seoDomains';
import { splitTerms } from '../filterTerms';

export const MAX_FILTER_CONDITIONS = 8;

const SCOPE_SLOTS: Readonly<Record<'keywords' | 'pages', Readonly<Record<DomainScope, number>>>> = {
  keywords: {
    exact_url: 4,
    subfolder: 4,
    domain: 1,
    subdomains: 0,
  },
  pages: {
    exact_url: 4,
    subfolder: 4,
    domain: 2,
    subdomains: 0,
  },
};

type KeywordBound = 'volume' | 'traffic' | 'cpc' | 'kd' | 'rank';
type PageBound = 'traffic' | 'keywords';

export const KEYWORD_BOUNDS: ReadonlyArray<{
  readonly id: KeywordBound;
  readonly label: string;
}> = [
  {
    id: 'traffic',
    label: 'Traffic',
  },
  {
    id: 'volume',
    label: 'Volume',
  },
  {
    id: 'cpc',
    label: 'CPC (USD)',
  },
  {
    id: 'kd',
    label: 'Difficulty',
  },
  {
    id: 'rank',
    label: 'Rank',
  },
];

export const PAGE_BOUNDS: ReadonlyArray<{
  readonly id: PageBound;
  readonly label: string;
}> = [
  {
    id: 'traffic',
    label: 'Traffic',
  },
  {
    id: 'keywords',
    label: 'Keywords',
  },
];

/** The text fields of a filter form, as typed (`min` / `max` keyed by bound id). */
export interface FilterForm {
  readonly include: string;
  readonly exclude: string;
  readonly search: string;
  readonly min: Readonly<Record<string, string | undefined>>;
  readonly max: Readonly<Record<string, string | undefined>>;
}

export function emptyFilterForm(): FilterForm {
  return {
    include: '',
    exclude: '',
    search: '',
    min: {},
    max: {},
  };
}

/** Comma- or plus-separated terms, trimmed, lower-cased, empty ones dropped. */
export function parseTerms(text: string): string[] {
  return splitTerms(text.toLowerCase());
}

/** A bound as a number of 0 or more; `undefined` when blank or not a number. */
export function parseBound(text: string | undefined): number | undefined {
  if (text === undefined || text.trim() === '') return undefined;
  const value = Number(text);
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

function boundCount(form: FilterForm, bounds: readonly string[]): number {
  return bounds.reduce((count, bound) => count
    + (parseBound(form.min[bound]) === undefined ? 0 : 1)
    + (parseBound(form.max[bound]) === undefined ? 0 : 1), 0);
}

function termCount(form: FilterForm): number {
  return parseTerms(form.include).length + parseTerms(form.exclude).length;
}

export function keywordConditionCount(form: FilterForm, scope: DomainScope): number {
  const search = form.search.trim() === '' ? 0 : 2;
  return SCOPE_SLOTS.keywords[scope] + termCount(form) + boundCount(form, KEYWORD_BOUNDS.map((bound) => bound.id)) + search;
}

export function pageConditionCount(form: FilterForm, scope: DomainScope): number {
  const search = form.search.trim() === '' ? 0 : 1;
  return SCOPE_SLOTS.pages[scope] + termCount(form) + boundCount(form, PAGE_BOUNDS.map((bound) => bound.id)) + search;
}

function optionalText(text: string): string | undefined {
  const trimmed = text.trim();
  return trimmed === '' ? undefined : trimmed;
}

function withoutUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter((entry) => entry[1] !== undefined)) as T;
}

export function keywordFilters(form: FilterForm): DomainKeywordFilters {
  return withoutUndefined({
    include: optionalText(form.include),
    exclude: optionalText(form.exclude),
    min_volume: parseBound(form.min.volume),
    max_volume: parseBound(form.max.volume),
    min_traffic: parseBound(form.min.traffic),
    max_traffic: parseBound(form.max.traffic),
    min_cpc: parseBound(form.min.cpc),
    max_cpc: parseBound(form.max.cpc),
    min_kd: parseBound(form.min.kd),
    max_kd: parseBound(form.max.kd),
    min_rank: parseBound(form.min.rank),
    max_rank: parseBound(form.max.rank),
  });
}

export function pageFilters(form: FilterForm): DomainPageFilters {
  return withoutUndefined({
    include: optionalText(form.include),
    exclude: optionalText(form.exclude),
    min_traffic: parseBound(form.min.traffic),
    max_traffic: parseBound(form.max.traffic),
    min_keywords: parseBound(form.min.keywords),
    max_keywords: parseBound(form.max.keywords),
  });
}

export function searchText(form: FilterForm): string | undefined {
  return optionalText(form.search);
}
