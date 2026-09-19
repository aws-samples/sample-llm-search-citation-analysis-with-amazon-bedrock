import {
  useState, type PropsWithChildren
} from 'react';
import { act } from '@testing-library/react';
import type { ResearchKeyword } from '../types';
import { useDashboardData } from './useDashboardData';
import {
  KEYWORD_RECONCILIATION_CONTEXT,
  type KeywordReconciliation,
  usePromoteKeywords,
} from './usePromoteKeywords';
import { renderSelectedPromotion } from './usePromoteKeywords-fixtures';

export function buildReconciliationWrapper(reconciliation: KeywordReconciliation) {
  return function ReconciliationWrapper({ children }: PropsWithChildren) {
    return (
      <KEYWORD_RECONCILIATION_CONTEXT.Provider value={reconciliation}>
        {children}
      </KEYWORD_RECONCILIATION_CONTEXT.Provider>
    );
  };
}

/**
 * Renders the hook under a reconciliation provider, selects 'alpha' and
 * awaits one promotion attempt, whatever way the scripted `apiPost` settles.
 */
export async function promoteWithReconciliation(reconciliation: KeywordReconciliation): Promise<void> {
  const { result } = renderSelectedPromotion({ wrapper: buildReconciliationWrapper(reconciliation) });
  await act(() => result.current.promote());
}

interface PendingPromotionChildProps {
  readonly availableKeywords: ResearchKeyword[];
  readonly keywordToPromote: string;
}

function PendingPromotionChild({
  availableKeywords,
  keywordToPromote,
}: PendingPromotionChildProps) {
  const promotion = usePromoteKeywords(availableKeywords);

  return (
    <>
      <button type="button" onClick={() => promotion.toggle(keywordToPromote)}>
        Select pending keyword
      </button>
      <button type="button" onClick={() => { void promotion.promote(); }}>
        Start pending promotion
      </button>
    </>
  );
}

export function PendingPromotionOwnerHarness({
  availableKeywords,
  keywordToPromote,
}: PendingPromotionChildProps) {
  const { reconcileKeywords } = useDashboardData();
  const [promotionMounted, setPromotionMounted] = useState(true);

  return (
    <KEYWORD_RECONCILIATION_CONTEXT.Provider value={reconcileKeywords}>
      {promotionMounted && (
        <PendingPromotionChild
          availableKeywords={availableKeywords}
          keywordToPromote={keywordToPromote}
        />
      )}
      <button type="button" onClick={() => setPromotionMounted(false)}>
        Leave keyword research
      </button>
    </KEYWORD_RECONCILIATION_CONTEXT.Provider>
  );
}
