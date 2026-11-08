/**
 * The filters of the three backlinks tables and DataForSEO's 8-condition
 * budget, counted exactly as the server counts it (`lambda/shared/backlinks_filters.py`):
 * every include or exclude term is one condition, as is every numeric bound
 * and every flag; a subfolder scope uses 4 conditions (links and pages only),
 * and hiding likely spam uses 2 (links and referring domains only). A request
 * over the budget is never sent: the server would refuse it.
 */
import type {
  BacklinksFilters, BacklinksScope, BacklinksTab
} from '../../../types/api/seoBacklinks';
import { splitTerms } from '../filterTerms';

export const MAX_FILTER_CONDITIONS = 8;
const SUBFOLDER_CONDITIONS = 4;
const SPAM_CONDITIONS = 2;

type NumericKey = {[K in keyof BacklinksFilters]-?: NonNullable<BacklinksFilters[K]> extends number ? K : never}[keyof BacklinksFilters];

export interface RangeFilter {
  readonly label: string;
  readonly min: NumericKey;
  readonly max: NumericKey;
}

export interface TabFilterFields {
  /** The label of the include / exclude text inputs ("Source URL", "Domain", "Page URL"). */
  readonly textLabel: string;
  readonly ranges: readonly RangeFilter[];
  /** Backlinks only: link type and the lost / broken toggles. */
  readonly linkFlags: boolean;
}

export const TAB_FILTER_FIELDS: Record<BacklinksTab, TabFilterFields> = {
  backlinks: {
    textLabel: 'Source URL',
    ranges: [
      {
        label: 'Domain authority',
        min: 'min_domain_rank',
        max: 'max_domain_rank',
      },
      {
        label: 'Link authority',
        min: 'min_link_rank',
        max: 'max_link_rank',
      },
      {
        label: 'Spam score',
        min: 'min_spam_score',
        max: 'max_spam_score',
      },
    ],
    linkFlags: true,
  },
  referring_domains: {
    textLabel: 'Domain',
    ranges: [
      {
        label: 'Backlinks',
        min: 'min_backlinks',
        max: 'max_backlinks',
      },
      {
        label: 'Rank',
        min: 'min_rank',
        max: 'max_rank',
      },
      {
        label: 'Spam score',
        min: 'min_spam_score',
        max: 'max_spam_score',
      },
    ],
    linkFlags: false,
  },
  top_pages: {
    textLabel: 'Page URL',
    ranges: [
      {
        label: 'Backlinks',
        min: 'min_backlinks',
        max: 'max_backlinks',
      },
      {
        label: 'Referring domains',
        min: 'min_referring_domains',
        max: 'max_referring_domains',
      },
      {
        label: 'Rank',
        min: 'min_rank',
        max: 'max_rank',
      },
    ],
    linkFlags: false,
  },
};

/** Include / exclude terms: split on `,` or `+`, trimmed, empty ones dropped. */
export function filterTerms(text: string | undefined): string[] {
  return splitTerms(text ?? '');
}

const NUMERIC_KEYS: readonly NumericKey[] = [...new Set(Object.values(TAB_FILTER_FIELDS)
  .flatMap((fields) => fields.ranges.flatMap((range) => [range.min, range.max])))];

/** How many DataForSEO conditions the user's own filters use. */
export function conditionCount(filters: BacklinksFilters): number {
  const bounds = NUMERIC_KEYS.filter((key) => filters[key] !== undefined).length;
  const flags = [
    filters.link_type !== undefined && filters.link_type !== 'all',
    filters.hide_lost === true,
    filters.hide_broken === true,
    filters.domain_from !== undefined && filters.domain_from !== '',
  ].filter(Boolean).length;
  return filterTerms(filters.include).length + filterTerms(filters.exclude).length + bounds + flags;
}

/** How many conditions the user's filters may use in `tab`: 8 minus the scope's and the spam rule's. */
export function conditionLimit(tab: BacklinksTab, scope: BacklinksScope, includeSpam: boolean): number {
  const scoped = scope === 'subfolder' && tab !== 'referring_domains' ? SUBFOLDER_CONDITIONS : 0;
  const spam = !includeSpam && tab !== 'top_pages' ? SPAM_CONDITIONS : 0;
  return MAX_FILTER_CONDITIONS - scoped - spam;
}

export function overBudgetMessage(limit: number): string {
  return `These filters exceed the ${limit}-condition limit for this view. Remove conditions in Filters`
    + ' or choose "Include likely spam". Your filters have been kept.';
}

/** The filters with empty texts and unset numbers left out, as the request sends them. */
export function cleanFilters(filters: BacklinksFilters): BacklinksFilters {
  return Object.fromEntries(Object.entries(filters).filter(([, value]) => (
    value !== undefined && value !== '' && value !== false && value !== 'all'
  )));
}

/** How many filter fields are set (the badge on the Filters button). */
export function activeFilterCount(filters: BacklinksFilters): number {
  return Object.keys(cleanFilters(filters)).length;
}
