import type { Stats } from './baseTypes';
import { isRecord } from './keywordDecoders';

const STAT_TOTALS = ['total_searches', 'total_citations', 'total_crawled', 'unique_keywords'] as const;

/** A `GET /stats` body: the four totals, and `counts_approximate` when the API sends it. */
export function isStats(value: unknown): value is Stats {
  return isRecord(value)
    && !('error' in value)
    && STAT_TOTALS.every((total) => typeof value[total] === 'number')
    && (value.counts_approximate === undefined || typeof value.counts_approximate === 'boolean');
}
