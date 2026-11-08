/**
 * Labels, help texts, cell formats and cache notes of the Backlinks page.
 * Unknown values show `—`, never 0: a spam score of 0 is "clean", a missing
 * one is "unknown".
 */
import type {
  BacklinksScope, BacklinksSummary, BacklinksTab
} from '../../../types/api/seoBacklinks';

import { UNKNOWN_VALUE } from '../../ui/numberFormat';

export { UNKNOWN_VALUE };

const WHOLE = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });
const ONE_DECIMAL = new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 });

/** A count or score: one decimal below 100, whole numbers from 100. */
export function formatMetric(value: number | null | undefined): string {
  if (value === null || value === undefined) return UNKNOWN_VALUE;
  return (Math.abs(value) >= 100 ? WHOLE : ONE_DECIMAL).format(value);
}

/** The day of a DataForSEO timestamp (`2026-09-01 10:00:00 +00:00` → `2026-09-01`). */
export function formatDay(value: string | null): string {
  return value === null ? UNKNOWN_VALUE : value.slice(0, 10);
}

export const SCOPE_OPTIONS: ReadonlyArray<{
  readonly id: BacklinksScope;
  readonly label: string;
  readonly description: string;
}> = [
  {
    id: 'subdomains',
    label: 'Subdomains',
    description: 'The domain plus all its subdomains (*.example.com/*)',
  },
  {
    id: 'domain',
    label: 'Domain',
    description: 'The hostname, without subdomains (example.com/*)',
  },
  {
    id: 'subfolder',
    label: 'Subfolder',
    description: 'The path and everything under it (example.com/path/*)',
  },
  {
    id: 'exact_url',
    label: 'Exact URL',
    description: 'One page only (example.com/path)',
  },
];

export function scopeLabel(scope: BacklinksScope): string {
  return SCOPE_OPTIONS.find((option) => option.id === scope)?.label ?? scope;
}

/** The overview metrics in display order, each with its help text. */
export const OVERVIEW_METRICS: ReadonlyArray<{
  readonly key: keyof BacklinksSummary;
  readonly label: string;
  readonly help: string;
}> = [
  {
    key: 'rank',
    label: 'Rank',
    help: "DataForSEO's 0-100 authority score of the target, from the number and strength of its links.",
  },
  {
    key: 'backlinks',
    label: 'Backlinks',
    help: 'Live links pointing at the target from other sites, including redirects and canonicals.',
  },
  {
    key: 'referring_domains',
    label: 'Referring domains',
    help: 'Distinct domains with at least one live link to the target.',
  },
  {
    key: 'referring_pages',
    label: 'Referring pages',
    help: 'Distinct pages with at least one live link to the target.',
  },
  {
    key: 'broken_backlinks',
    label: 'Broken backlinks',
    help: 'Links that point at a page of the target that no longer answers.',
  },
  {
    key: 'broken_pages',
    label: 'Broken pages',
    help: 'Pages of the target that other sites link to but that no longer answer.',
  },
  {
    key: 'backlinks_spam_score',
    label: 'Backlink spam score',
    help: 'Estimated spam risk of the links to the target (0-100). Higher scores are more likely manipulative or low quality.',
  },
  {
    key: 'target_spam_score',
    label: 'Target spam score',
    help: 'Estimated spam risk of the target itself (0-100).',
  },
  {
    key: 'new_backlinks',
    label: 'New backlinks',
    help: 'Links DataForSEO found recently (its own recent window, not this lookup).',
  },
  {
    key: 'lost_backlinks',
    label: 'Lost backlinks',
    help: 'Links DataForSEO recently found gone.',
  },
  {
    key: 'new_referring_domains',
    label: 'New referring domains',
    help: 'Domains DataForSEO recently found linking for the first time.',
  },
  {
    key: 'lost_referring_domains',
    label: 'Lost referring domains',
    help: 'Domains DataForSEO recently found no longer linking.',
  },
];

export const TAB_LABELS: Record<BacklinksTab, string> = {
  backlinks: 'Backlinks',
  referring_domains: 'Referring domains',
  top_pages: 'Top pages',
};

export const TAB_DESCRIPTIONS: Record<BacklinksTab, string> = {
  backlinks: 'Individual links pointing at the target, newest first.',
  referring_domains: 'Domains linking to the target, strongest first.',
  top_pages: "The target's pages that attract the most links.",
};

export const LOOKUP_NOTES = {
  overview: 'Answers are cached for 6 hours.',
  table: 'Expanding a domain asks for one more page.',
} as const;

/** Shown under an answer that came from the 6-hour cache. */
export const CACHED_NOTE = 'From cache (refreshes every 6 hours)';
