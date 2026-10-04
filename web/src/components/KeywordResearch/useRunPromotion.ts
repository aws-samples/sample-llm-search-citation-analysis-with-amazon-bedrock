import { useEffect } from 'react';
import type {
  Keyword, ResearchKeyword
} from '../../types';
import { usePromoteKeywords } from '../../hooks/usePromoteKeywords';

/**
 * Promotion state for the keywords a research run view shows. A new
 * `shown` value (a new result, another section) clears the selection: a
 * promotion must never carry keywords the user can no longer see.
 */
export function useRunPromotion(
  keywords: ResearchKeyword[],
  onKeywordsAdded: ((created: Keyword[]) => void) | undefined,
  shown: unknown,
) {
  const promotion = usePromoteKeywords(keywords, onKeywordsAdded);
  const { clearSelection } = promotion;

  useEffect(() => {
    clearSelection();
  }, [shown, clearSelection]);

  return promotion;
}
