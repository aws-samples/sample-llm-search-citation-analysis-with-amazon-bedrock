import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { promoteKeywords } from '../api/keywords';
import type { PromotionOutcome } from '../api/keywords';
import {
  clientRejectionMessage, getErrorMessage, isAbortError, isDefinitiveClientRejection
} from '../infrastructure';
import type {
  Keyword, ResearchKeyword
} from '../types';
import {
  keywordSelectionKey, uniqueResearchKeywords
} from './keywordIdentity';

export const SELECTION_LIMIT = 500;
export const PROMOTION_TIMEOUT_MS = 30_000;
export const PROMOTION_SUCCESS_MESSAGE_MS = 5_000;

export const SELECTION_LIMIT_MESSAGE =
  `Selection limit reached: at most ${SELECTION_LIMIT} keywords can be added at once.`;
export const EMPTY_SELECTION_MESSAGE = 'Select at least one keyword to add.';
export const STALE_SELECTION_MESSAGE =
  'The research results changed. Review your selection and try again.';
export const PROMOTION_TIMEOUT_MESSAGE =
  'Adding keywords did not return within 30 seconds. The server may still finish; active keywords are being refreshed.';

export type KeywordReconciliation = () => void | Promise<void>;

export const KEYWORD_RECONCILIATION_CONTEXT =
  createContext<KeywordReconciliation | undefined>(undefined);

export function promotionSuccessMessage(outcome: PromotionOutcome): string {
  const added = `${outcome.created} ${outcome.created === 1 ? 'keyword' : 'keywords'} added`;
  return outcome.skipped > 0 ? `${added}, ${outcome.skipped} already existed` : added;
}

export type SelectionAction =
  | {
    type: 'toggle';
    keyword: string;
  }
  | { type: 'clear' }
  | {
    type: 'retain';
    available: string[];
  }
  | {
    type: 'reconcile';
    created: string[];
    skipped: string[];
  };

export interface SelectionState {
  selected: string[];
  limitMessage: string | null;
}

export const initialSelectionState: SelectionState = {
  selected: [],
  limitMessage: null,
};

function toggleSelection(state: SelectionState, keyword: string): SelectionState {
  const key = keywordSelectionKey(keyword);
  if (!key) return state;

  if (state.selected.includes(key)) {
    return {
      selected: state.selected.filter((selectedKey) => selectedKey !== key),
      limitMessage: null,
    };
  }

  if (state.selected.length >= SELECTION_LIMIT) {
    return {
      selected: state.selected,
      limitMessage: SELECTION_LIMIT_MESSAGE,
    };
  }

  return {
    selected: [...state.selected, key],
    limitMessage: null,
  };
}

function reconcileSelection(
  state: SelectionState,
  created: string[],
  skipped: string[]
): SelectionState {
  const createdKeys = new Set(created.map(keywordSelectionKey));
  const retainedKeys = new Set(
    skipped.map(keywordSelectionKey).filter((key) => !createdKeys.has(key))
  );

  return {
    selected: state.selected.filter((key) => retainedKeys.has(key)),
    limitMessage: null,
  };
}

export function reduceSelection(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'toggle':
      return toggleSelection(state, action.keyword);
    case 'clear':
      return initialSelectionState;
    case 'retain': {
      const availableKeys = new Set(action.available.map(keywordSelectionKey));
      return {
        selected: state.selected.filter((key) => availableKeys.has(key)),
        limitMessage: null,
      };
    }
    case 'reconcile':
      return reconcileSelection(state, action.created, action.skipped);
    default:
      return state;
  }
}

function findResearchKeyword(
  key: string,
  availableKeywords: readonly ResearchKeyword[]
): ResearchKeyword | undefined {
  return availableKeywords.find(
    (candidate) => keywordSelectionKey(candidate.keyword) === key
  );
}

export interface UsePromoteKeywords {
  selected: string[];
  selectedCount: number;
  atLimit: boolean;
  canPromote: boolean;
  submitting: boolean;
  error: string | null;
  limitMessage: string | null;
  outcome: PromotionOutcome | null;
  toggle: (keyword: string) => void;
  clearSelection: () => void;
  promote: () => Promise<void>;
}

const EMPTY_RESEARCH_KEYWORDS: ResearchKeyword[] = [];

export const usePromoteKeywords = (
  availableKeywords: ResearchKeyword[] = EMPTY_RESEARCH_KEYWORDS,
  onKeywordsAdded?: (created: Keyword[]) => void
): UsePromoteKeywords => {
  const [selectionState, dispatchSelection] = useReducer(reduceSelection, initialSelectionState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PromotionOutcome | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const requestTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activeRequestRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const reconciliation = useContext(KEYWORD_RECONCILIATION_CONTEXT);

  const availableUniqueKeywords = useMemo(
    () => uniqueResearchKeywords(availableKeywords),
    [availableKeywords]
  );
  const availableKeys = useMemo(
    () => availableUniqueKeywords.map((keyword) => keywordSelectionKey(keyword.keyword)),
    [availableUniqueKeywords]
  );

  const {
    selected, limitMessage
  } = selectionState;

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  const clearRequestTimer = useCallback((timerId?: ReturnType<typeof setTimeout>) => {
    const timerToClear = timerId ?? requestTimerRef.current;
    if (timerToClear !== null) {
      clearTimeout(timerToClear);
      if (requestTimerRef.current === timerToClear) requestTimerRef.current = null;
    }
  }, []);

  const requestKeywordReconciliation = useCallback(() => {
    try {
      const pendingReconciliation = reconciliation?.();
      if (pendingReconciliation !== undefined) {
        void pendingReconciliation.catch((reconciliationError: unknown) => {
          console.error('[keywords] Error refreshing active keywords:', reconciliationError);
        });
      }
    } catch (reconciliationError) {
      console.error('[keywords] Error refreshing active keywords:', reconciliationError);
    }
  }, [reconciliation]);

  const cancelActiveRequest = useCallback((): boolean => {
    const activeRequest = activeRequestRef.current;
    if (activeRequest === null) return false;

    activeRequestRef.current = null;
    clearRequestTimer();
    activeRequest.abort();
    requestKeywordReconciliation();
    return true;
  }, [clearRequestTimer, requestKeywordReconciliation]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearSuccessTimer();
      cancelActiveRequest();
    };
  }, [cancelActiveRequest, clearSuccessTimer]);

  useEffect(() => {
    dispatchSelection({
      type: 'retain',
      available: availableKeys,
    });

    if (cancelActiveRequest()) setSubmitting(false);
  }, [availableKeys, cancelActiveRequest]);

  const toggle = useCallback((keyword: string) => {
    dispatchSelection({
      type: 'toggle',
      keyword,
    });
  }, []);

  const clearSelection = useCallback(() => {
    dispatchSelection({ type: 'clear' });
    setError(null);
    clearSuccessTimer();
    setOutcome(null);
    if (cancelActiveRequest()) setSubmitting(false);
  }, [cancelActiveRequest, clearSuccessTimer]);

  const promote = useCallback(async (): Promise<void> => {
    if (activeRequestRef.current !== null) return;

    if (selected.length === 0) {
      setError(EMPTY_SELECTION_MESSAGE);
      return;
    }

    const requestedKeywords = selected.map(
      (key) => findResearchKeyword(key, availableUniqueKeywords)
    );
    if (requestedKeywords.some((keyword) => keyword === undefined)) {
      dispatchSelection({
        type: 'retain',
        available: availableKeys,
      });
      setError(STALE_SELECTION_MESSAGE);
      return;
    }

    const controller = new AbortController();
    activeRequestRef.current = controller;
    setError(null);
    clearSuccessTimer();
    setOutcome(null);
    setSubmitting(true);

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, PROMOTION_TIMEOUT_MS);
    requestTimerRef.current = timeoutId;

    try {
      const result = await promoteKeywords({
        keywords: requestedKeywords.filter(
          (keyword): keyword is ResearchKeyword => keyword !== undefined
        ),
        signal: controller.signal,
      });

      if (activeRequestRef.current !== controller || !mountedRef.current) return;

      setOutcome(result);
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null;
        if (mountedRef.current) setOutcome(null);
      }, PROMOTION_SUCCESS_MESSAGE_MS);

      dispatchSelection({
        type: 'reconcile',
        created: result.createdKeywords,
        skipped: result.skippedKeywords,
      });

      if (result.createdItems.length > 0) {
        onKeywordsAdded?.(result.createdItems);
      }
      requestKeywordReconciliation();
    } catch (requestError) {
      if (activeRequestRef.current !== controller || !mountedRef.current) return;

      if (isAbortError(requestError)) {
        setError(PROMOTION_TIMEOUT_MESSAGE);
        requestKeywordReconciliation();
      } else if (isDefinitiveClientRejection(requestError)) {
        setError(clientRejectionMessage(requestError, 'keywords', { includeField: true }));
      } else {
        setError(`Adding keywords failed to return a confirmed result: ${getErrorMessage(requestError, 'keywords')}. The server may still have completed; active keywords are being refreshed.`);
        requestKeywordReconciliation();
      }
      console.error('[keywords] Error promoting keywords:', requestError);
    } finally {
      if (activeRequestRef.current === controller) {
        clearRequestTimer(timeoutId);
        activeRequestRef.current = null;
        if (mountedRef.current) setSubmitting(false);
      }
    }
  }, [
    selected,
    availableUniqueKeywords,
    availableKeys,
    onKeywordsAdded,
    clearRequestTimer,
    clearSuccessTimer,
    requestKeywordReconciliation,
  ]);

  return {
    selected,
    selectedCount: selected.length,
    atLimit: selected.length === SELECTION_LIMIT,
    canPromote: selected.length > 0 && !submitting,
    submitting,
    error,
    limitMessage,
    outcome,
    toggle,
    clearSelection,
    promote,
  };
};
