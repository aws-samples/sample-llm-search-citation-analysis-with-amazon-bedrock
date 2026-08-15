/**
 * Keyword promotion API client functions.
 */
import { apiPost } from './client';
import type {
  Keyword, KeywordExtended, ResearchKeyword
} from '../types';

interface PromoteKeywordsOptions {
  keywords: ResearchKeyword[];
  status?: NonNullable<Keyword['status']>;
  priority?: NonNullable<KeywordExtended['priority']>;
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
    keywords, status, priority, signal
  } = options;
  const wire = await apiPost<PromoteKeywordsResponse>(
    '/keywords/promote',
    {
      keywords,
      ...(status === undefined ? {} : { status }),
      ...(priority === undefined ? {} : { priority }),
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
