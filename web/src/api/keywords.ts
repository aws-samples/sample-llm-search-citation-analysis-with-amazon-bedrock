/**
 * Keyword promotion API client functions.
 */
import { apiPost } from './client';
import type {
  Keyword, KeywordExtended, ResearchKeyword
} from '../types';

export type PromoteKeywordEntry = ResearchKeyword & {
  /** Overrides the request-level status for this keyword only. */
  status?: NonNullable<Keyword['status']>;
};

export interface PromoteKeywordsOptions {
  keywords: PromoteKeywordEntry[];
  status?: NonNullable<Keyword['status']>;
  priority?: NonNullable<KeywordExtended['priority']>;
  /** Keyword groups the new keywords join (e.g. the hotel a research run was for). */
  groupIds?: string[];
  signal?: AbortSignal;
}

interface PromoteKeywordsResponse {
  created: number;
  skipped: number;
  created_keywords: Keyword[];
  skipped_keywords: {
    keyword: string;
    reason: 'duplicate' | 'empty';
  }[];
}

export interface PromotionOutcome {
  created: number;
  skipped: number;
  createdKeywords: string[];
  createdItems: Keyword[];
  skippedKeywords: string[];
}

export async function promoteKeywords(
  options: PromoteKeywordsOptions
): Promise<PromotionOutcome> {
  const {
    keywords, status, priority, groupIds, signal
  } = options;
  const wire = await apiPost<PromoteKeywordsResponse>(
    '/keywords/promote',
    {
      keywords,
      ...(status === undefined ? {} : { status }),
      ...(priority === undefined ? {} : { priority }),
      ...(groupIds === undefined || groupIds.length === 0 ? {} : { group_ids: groupIds }),
    },
    {
      signal,
      allowStructured4xx: true,
    }
  );

  return {
    created: wire.created,
    skipped: wire.skipped,
    createdKeywords: wire.created_keywords.map((keyword) => keyword.keyword),
    createdItems: wire.created_keywords,
    skippedKeywords: wire.skipped_keywords
      .filter((keyword) => keyword.reason === 'duplicate')
      .map((keyword) => keyword.keyword),
  };
}
