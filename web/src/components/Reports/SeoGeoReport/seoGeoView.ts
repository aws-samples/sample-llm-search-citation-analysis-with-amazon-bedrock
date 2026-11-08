/**
 * How the SEO vs GEO report words and colours a row of `GET /api/seo/seo-geo`.
 * The rules (positions, quadrants, overlap) are the server's; this only
 * formats them.
 */
import {
  quadrantDefinition, SEO_TOP_POSITION
} from '../../../constants/seoGeoDefinitions';
import type {
  SeoGeoQuadrant, SeoGeoRow
} from '../../../types/api/seo';

const UNKNOWN = '—';

const NUMBER = new Intl.NumberFormat('en-US');

/** Whether the keyword has a Google AI Overviews result to read its organic top 10 from. */
export function hasOrganicSnapshot(row: Pick<SeoGeoRow, 'ai_overview_shown'>): boolean {
  return row.ai_overview_shown !== null;
}

/** `3`, `">10"` when a results page was read and none of the domains is in its top 10, a dash without one. */
export function positionText(position: number | null, snapshot: boolean): string {
  if (position !== null) return String(position);
  return snapshot ? `>${SEO_TOP_POSITION}` : UNKNOWN;
}

export function organicPositionText(row: Pick<SeoGeoRow, 'organic_position' | 'ai_overview_shown'>): string {
  return positionText(row.organic_position, hasOrganicSnapshot(row));
}

const SOURCE_NOTES: Readonly<Record<'ranked_keywords' | 'rank_tracking', string>> = {
  ranked_keywords: 'snapshot',
  rank_tracking: 'tracked',
};

/** `14 (snapshot)` / `18 (tracked)` when a deeper source ranks you beyond the top 10; a dash otherwise. */
export function rankedPositionText(row: Pick<SeoGeoRow, 'ranked_position' | 'organic_position_source'>): string {
  const source = row.organic_position_source;
  if (row.ranked_position === null || source === null || source === 'serp_top10') return UNKNOWN;
  return `${row.ranked_position} (${SOURCE_NOTES[source]})`;
}

/** `1,240` estimated visits a month, a dash without a snapshot. */
export function trafficText(value: number | null): string {
  return value === null ? UNKNOWN : NUMBER.format(Math.round(value));
}

export function yesNoText(value: boolean | null): string {
  if (value === null) return UNKNOWN;
  return value ? 'Yes' : 'No';
}

/** `62.5%`, a dash when unknown. */
export function percentText(value: number | null): string {
  return value === null ? UNKNOWN : `${value.toFixed(1)}%`;
}

/** `12,100`, a dash when unknown. */
export function volumeText(value: number | null): string {
  return value === null ? UNKNOWN : NUMBER.format(value);
}

export function quadrantLabel(quadrant: SeoGeoQuadrant): string {
  return quadrantDefinition(quadrant)?.label ?? quadrant;
}

const QUADRANT_BADGE_CLASSES: Readonly<Record<SeoGeoQuadrant, string>> = {
  both_strong: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200',
  ai_gap: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  seo_gap: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/40 dark:text-indigo-200',
  both_weak: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200',
  no_data: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-200',
};

export function quadrantBadgeClass(quadrant: SeoGeoQuadrant): string {
  return QUADRANT_BADGE_CLASSES[quadrant];
}
