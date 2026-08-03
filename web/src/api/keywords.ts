/**
 * Keyword promotion API client functions.
 */
import { apiPost } from './client';
import type { ResearchKeyword } from '../types';

interface PromoteKeywordsOptions {
  keywords: ResearchKeyword[];
  status?: string;
  priority?: string;
  signal?: AbortSignal;
}

/**
 * Wire type: mirrors the backend success response exactly (snake_case, object
 * entries). Kept distinct from the `PromotionOutcome` domain type below.
 */
interface PromoteKeywordsResponse {
  created: number;
  skipped: number;
  created_keywords: {
    id: string;
    keyword: string;
  }[];
  skipped_keywords: {
    keyword: string;
    reason: 'duplicate' | 'empty';
  }[];
}

/**
 * Frontend domain shape of a promotion result.
 *
 * `skipped` is the backend's duplicate-only count, so after the
 * `reason === 'duplicate'` filter applied in `promoteKeywords`,
 * `skipped === skippedKeywords.length` holds — the pass-through is consistent,
 * not lossy.
 */
export interface PromotionOutcome {
  created: number;
  skipped: number;
  createdKeywords: string[];
  /** Duplicate-reason texts ONLY; empty-reason entries are not retained. */
  skippedKeywords: string[];
}

/**
 * Promotes selected research keywords into the active keywords set.
 *
 * This is the single mapping boundary between the wire shape and the frontend
 * domain type: no snake_case field escapes this module.
 *
 * The optional `signal` is forwarded to `apiPost` so callers can arm an
 * `AbortController` timeout around the request.
 */
export async function promoteKeywords(
  options: PromoteKeywordsOptions
): Promise<PromotionOutcome> {
  const {
    keywords, status, priority, signal 
  } = options;
  const wire = await apiPost<PromoteKeywordsResponse>(
    '/keywords/promote',
    {
      keywords,
      status,
      priority,
    },
    { signal }
  );
  return {
    created: wire.created,
    skipped: wire.skipped,
    createdKeywords: wire.created_keywords.map((k) => k.keyword),
    // Duplicates ONLY: skipped duplicates stay selected after promotion, while
    // empty-text entries (reason 'empty') must not be retained.
    skippedKeywords: wire.skipped_keywords
      .filter((k) => k.reason === 'duplicate')
      .map((k) => k.keyword),
  };
}
