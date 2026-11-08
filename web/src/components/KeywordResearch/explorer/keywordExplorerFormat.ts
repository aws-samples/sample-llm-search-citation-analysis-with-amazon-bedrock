/**
 * Cell texts of the Keyword Explorer (volume with
 * `Intl.NumberFormat`, CPC `$x.xx`, competition `0.xx`).
 */
import type {
  KeywordIntent, MonthlySearch
} from '../../../types/api/seo';

export const UNKNOWN_VALUE = '—';

const VOLUME_FORMAT = new Intl.NumberFormat('en-US');

export const INTENT_LABELS: Record<KeywordIntent, string> = {
  informational: 'Informational',
  commercial: 'Commercial',
  transactional: 'Transactional',
  navigational: 'Navigational',
  unknown: 'Unknown',
};

export function formatVolume(value: number | null): string {
  return value === null ? UNKNOWN_VALUE : VOLUME_FORMAT.format(value);
}

export function formatCpc(value: number | null): string {
  return value === null ? UNKNOWN_VALUE : `$${value.toFixed(2)}`;
}

export function formatCompetition(value: number | null): string {
  return value === null ? UNKNOWN_VALUE : value.toFixed(2);
}

export function formatDifficulty(value: number | null): string {
  return value === null ? UNKNOWN_VALUE : String(value);
}

/** The last 12 months of `trend`, oldest first. */
export function trendSeries(trend: readonly MonthlySearch[]): number[] {
  return [...trend]
    .sort((left, right) => (left.year * 100 + left.month) - (right.year * 100 + right.month))
    .slice(-12)
    .map((month) => month.search_volume);
}
