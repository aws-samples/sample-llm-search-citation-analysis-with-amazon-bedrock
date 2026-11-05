/**
 * Keyword promotion API client functions.
 */
import { apiPost } from './client';
import type {
  Keyword, KeywordExtended, ResearchKeyword
} from '../types';
import { keywordSelectionKey } from '../hooks/keywordIdentity';
import {
  IncompleteWriteError, MAX_WRITE_ROUNDS
} from './writeRounds';

export type PromoteKeywordEntry = ResearchKeyword & {
  /** Overrides the request-level status for this keyword only. */
  status?: NonNullable<Keyword['status']>;
};

export interface PromoteKeywordsOptions {
  keywords: PromoteKeywordEntry[];
  status?: NonNullable<Keyword['status']>;
  priority?: NonNullable<KeywordExtended['priority']>;
  /** Keyword groups every promoted keyword should join. */
  groupIds?: string[];
  /** The market every promoted keyword is created in (absent = no market). */
  marketId?: string | null;
  signal?: AbortSignal;
}

export interface PromoteKeywordsResponse {
  created: number;
  skipped: number;
  created_keywords: Keyword[];
  skipped_keywords: {
    keyword: string;
    reason: 'duplicate' | 'empty';
  }[];
  /** Absent on API versions predating grouped-existing promotion. */
  grouped_keywords?: string[];
  /** Keywords the request's time budget left unwritten: send them again (absent before 2.42.0). */
  pending_keywords?: string[];
  truncated?: boolean;
}

export interface PromotionOutcome {
  created: number;
  skipped: number;
  createdKeywords: string[];
  createdItems: Keyword[];
  skippedKeywords: string[];
  groupedKeywords: string[];
}

/**
 * The promotion still had keywords pending after `MAX_WRITE_ROUNDS` requests.
 * `outcome` is what the requests did write (stored, and safe to show).
 */
export class IncompletePromotionError extends IncompleteWriteError {
  readonly outcome: PromotionOutcome;

  constructor(outcome: PromotionOutcome, pendingCount: number) {
    super(
      `${outcome.created} ${outcome.created === 1 ? 'keyword' : 'keywords'} added, but ${pendingCount} could not be added after ${MAX_WRITE_ROUNDS} attempts. Add them again to finish.`,
      pendingCount
    );
    this.name = 'IncompletePromotionError';
    this.outcome = outcome;
  }
}

function postPromotion(
  options: PromoteKeywordsOptions,
  keywords: PromoteKeywordEntry[]
): Promise<PromoteKeywordsResponse> {
  const {
    status, priority, groupIds, marketId, signal
  } = options;
  return apiPost<PromoteKeywordsResponse>(
    '/keywords/promote',
    {
      keywords,
      ...(status === undefined ? {} : { status }),
      ...(priority === undefined ? {} : { priority }),
      ...(groupIds === undefined || groupIds.length === 0 ? {} : { group_ids: groupIds }),
      ...(marketId ? { market_id: marketId } : {}),
    },
    {
      signal,
      allowStructured4xx: true,
    }
  );
}

function toOutcome(wire: PromoteKeywordsResponse): PromotionOutcome {
  return {
    created: wire.created,
    skipped: wire.skipped,
    createdKeywords: wire.created_keywords.map((keyword) => keyword.keyword),
    createdItems: wire.created_keywords,
    skippedKeywords: wire.skipped_keywords
      .filter((keyword) => keyword.reason === 'duplicate')
      .map((keyword) => keyword.keyword),
    groupedKeywords: wire.grouped_keywords ?? [],
  };
}

/** `earlier`'s texts plus the ones of `later` it does not hold yet (by keyword identity). */
function unionTexts(earlier: string[], later: string[]): string[] {
  const seen = new Set(earlier.map(keywordSelectionKey));
  return [...earlier, ...later.filter((text) => !seen.has(keywordSelectionKey(text)))];
}

/**
 * One outcome for two rounds of the same promotion. A pending grouping is
 * re-sent and reported skipped again, so skips and groupings are counted once.
 */
function mergeOutcomes(earlier: PromotionOutcome, later: PromotionOutcome): PromotionOutcome {
  const skippedKeywords = unionTexts(earlier.skippedKeywords, later.skippedKeywords);
  return {
    created: earlier.created + later.created,
    skipped: earlier.skipped + skippedKeywords.length - earlier.skippedKeywords.length,
    createdKeywords: [...earlier.createdKeywords, ...later.createdKeywords],
    createdItems: [...earlier.createdItems, ...later.createdItems],
    skippedKeywords,
    groupedKeywords: unionTexts(earlier.groupedKeywords, later.groupedKeywords),
  };
}

/** The entries of `sent` the answer left pending, matched by keyword identity. */
function pendingEntries(sent: PromoteKeywordEntry[], wire: PromoteKeywordsResponse): PromoteKeywordEntry[] {
  const pending = new Set((wire.pending_keywords ?? []).map(keywordSelectionKey));
  return sent.filter((entry) => pending.has(keywordSelectionKey(entry.keyword)));
}

async function promoteRound(
  options: PromoteKeywordsOptions,
  keywords: PromoteKeywordEntry[],
  round: number,
  earlier: PromotionOutcome | null
): Promise<PromotionOutcome> {
  const wire = await postPromotion(options, keywords);
  const outcome = earlier === null ? toOutcome(wire) : mergeOutcomes(earlier, toOutcome(wire));
  const pending = pendingEntries(keywords, wire);
  if (pending.length === 0) return outcome;
  if (round >= MAX_WRITE_ROUNDS) throw new IncompletePromotionError(outcome, pending.length);
  return promoteRound(options, pending, round + 1, outcome);
}

/**
 * Promotes `options.keywords`. The keywords an answer leaves pending (the
 * server's time budget ran out; every write is idempotent) are sent again, at
 * most `MAX_WRITE_ROUNDS` requests in all, and the answers merged into one
 * outcome; after the last round `IncompletePromotionError` carries what was
 * written. An abort of `options.signal` stops the rounds.
 */
export async function promoteKeywords(
  options: PromoteKeywordsOptions
): Promise<PromotionOutcome> {
  return promoteRound(options, options.keywords, 1, null);
}
