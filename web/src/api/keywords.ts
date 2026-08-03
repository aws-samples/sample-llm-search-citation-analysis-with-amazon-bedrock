/**
 * Keyword promotion API client functions.
 */
import { apiPost } from './client';
import type {
  Keyword, ResearchKeyword 
} from '../types';

/**
 * `status` and `priority` stay available on the API surface even though the
 * promotion UI no longer exposes pickers for them: the backend resolves an
 * omitted or empty value to `active` / `normal`.
 */
interface PromoteKeywordsOptions {
  keywords: ResearchKeyword[];
  status?: string;
  priority?: string;
  signal?: AbortSignal;
}

/**
 * Wire type: mirrors the backend success response exactly (snake_case, object
 * entries). Kept distinct from the `PromotionOutcome` domain type below.
 *
 * `created_keywords` carries the COMPLETE created items, which are already the
 * `Keyword` shape the active keyword list holds, so they are reused as-is
 * rather than re-declared here.
 */
interface PromoteKeywordsResponse {
  created: number;
  skipped: number;
  created_keywords: Keyword[];
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
  /**
   * The complete created keywords, ready to be inserted into the active keyword
   * list without a refetch. Always `created` entries long.
   */
  createdItems: Keyword[];
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
  // An unspecified status/priority is OMITTED from the body rather than sent as
  // a guessed value, so the backend applies its own documented defaults.
  const wire = await apiPost<PromoteKeywordsResponse>(
    '/keywords/promote',
    {
      keywords,
      ...(status === undefined ? {} : { status }),
      ...(priority === undefined ? {} : { priority }),
    },
    { signal }
  );
  return {
    created: wire.created,
    skipped: wire.skipped,
    createdKeywords: wire.created_keywords.map((k) => k.keyword),
    createdItems: wire.created_keywords,
    // Duplicates ONLY: skipped duplicates stay selected after promotion, while
    // empty-text entries (reason 'empty') must not be retained.
    skippedKeywords: wire.skipped_keywords
      .filter((k) => k.reason === 'duplicate')
      .map((k) => k.keyword),
  };
}
