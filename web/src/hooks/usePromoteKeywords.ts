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
import type {
  PromoteKeywordEntry, PromotionOutcome
} from '../api/keywords';
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
const EMPTY_SELECTION_MESSAGE = 'Select at least one keyword to add.';
const EMPTY_PROPOSAL_MESSAGE = 'No proposal keywords are available to add.';
const STALE_SELECTION_MESSAGE =
  'The research results changed. Review your selection and try again.';
export const PROMOTION_TIMEOUT_MESSAGE =
  'Adding keywords did not return within 30 seconds. The server may still finish; active keywords are being refreshed.';

export type KeywordReconciliation = () => void | Promise<void>;

export const KEYWORD_RECONCILIATION_CONTEXT =
  createContext<KeywordReconciliation | undefined>(undefined);

export function promotionSuccessMessage<
  PromotionCounts extends Pick<PromotionOutcome, 'created' | 'skipped'>
>(outcome: PromotionCounts): string {
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
    type: 'replace';
    keywords: string[];
  }
  | {
    type: 'retain';
    available: string[];
  }
  | {
    type: 'reconcile';
    created: string[];
    grouped: string[];
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

function normalizedSelection(keywords: readonly string[]): SelectionState {
  const uniqueKeys = [...new Set(keywords.map(keywordSelectionKey).filter(Boolean))];
  return {
    selected: uniqueKeys.slice(0, SELECTION_LIMIT),
    limitMessage: uniqueKeys.length > SELECTION_LIMIT ? SELECTION_LIMIT_MESSAGE : null,
  };
}

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
  grouped: string[],
  skipped: string[]
): SelectionState {
  const successfulKeys = new Set([...created, ...grouped].map(keywordSelectionKey));
  const retainedKeys = new Set(
    skipped.map(keywordSelectionKey).filter((key) => !successfulKeys.has(key))
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
    case 'replace':
      return normalizedSelection(action.keywords);
    case 'retain': {
      const availableKeys = new Set(action.available.map(keywordSelectionKey));
      return {
        selected: state.selected.filter((key) => availableKeys.has(key)),
        limitMessage: null,
      };
    }
    case 'reconcile':
      return reconcileSelection(state, action.created, action.grouped, action.skipped);
    default:
      return state;
  }
}

/**
 * The research rows behind the selected keys, in selection order; null when a
 * key no longer has a row because the results changed under the selection.
 */
function selectedResearchKeywords(
  selected: readonly string[],
  availableKeywords: readonly ResearchKeyword[]
): ResearchKeyword[] | null {
  const rows = selected.map((key) => availableKeywords.find(
    (candidate) => keywordSelectionKey(candidate.keyword) === key
  ));
  return rows.every((row): row is ResearchKeyword => row !== undefined) ? rows : null;
}

interface PromotionFailure {
  message: string;
  /** Whether the server may still have completed the request, so the active keywords must be re-read. */
  reconcile: boolean;
}

function describePromotionFailure(requestError: unknown): PromotionFailure {
  if (isAbortError(requestError)) {
    return {
      message: PROMOTION_TIMEOUT_MESSAGE,
      reconcile: true,
    };
  }
  if (isDefinitiveClientRejection(requestError)) {
    return {
      message: clientRejectionMessage(requestError, 'keywords', { includeField: true }),
      reconcile: false,
    };
  }
  return {
    message: `Adding keywords failed to return a confirmed result: ${getErrorMessage(requestError, 'keywords')}. The server may still have completed; active keywords are being refreshed.`,
    reconcile: true,
  };
}

/** Which promote button is in flight: the ticked rows, or the whole proposal. */
export type PromotionAction = 'selected' | 'proposal';

export interface UsePromoteKeywords {
  /** Selection keys (see `keywordSelectionKey`) of the ticked rows, for the tables' checkboxes. */
  selectedKeys: Set<string>;
  selectedCount: number;
  atLimit: boolean;
  canPromote: boolean;
  canPromoteProposal: boolean;
  submitting: boolean;
  submittingAction: PromotionAction | null;
  error: string | null;
  limitMessage: string | null;
  outcome: PromotionOutcome | null;
  toggle: (keyword: string) => void;
  clearSelection: () => void;
  replaceSelection: (keywords: readonly string[]) => void;
  promote: () => Promise<void>;
  promoteProposal: () => Promise<void>;
}

const EMPTY_RESEARCH_KEYWORDS: ResearchKeyword[] = [];
const NO_GROUPS: string[] = [];

export interface UsePromoteKeywordsOptions {
  /** Groups every promoted keyword joins (the research agent's destination group). */
  groupIds?: string[];
}

export const usePromoteKeywords = (
  availableKeywords: ResearchKeyword[] = EMPTY_RESEARCH_KEYWORDS,
  onKeywordsAdded?: (created: Keyword[]) => void,
  options: UsePromoteKeywordsOptions = {}
): UsePromoteKeywords => {
  const groupIds = options.groupIds ?? NO_GROUPS;
  const [selectionState, dispatchSelection] = useReducer(reduceSelection, initialSelectionState);
  const [submittingAction, setSubmittingAction] = useState<PromotionAction | null>(null);
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
  const selectedKeys = useMemo(() => new Set(selected), [selected]);

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

    if (cancelActiveRequest()) setSubmittingAction(null);
  }, [availableKeys, cancelActiveRequest]);

  const toggle = useCallback((keyword: string) => {
    dispatchSelection({
      type: 'toggle',
      keyword,
    });
  }, []);

  const replaceSelection = useCallback((keywords: readonly string[]) => {
    dispatchSelection({
      type: 'replace',
      keywords: [...keywords],
    });
    setError(null);
    clearSuccessTimer();
    setOutcome(null);
    if (cancelActiveRequest()) setSubmittingAction(null);
  }, [cancelActiveRequest, clearSuccessTimer]);

  const clearSelection = useCallback(() => {
    replaceSelection([]);
  }, [replaceSelection]);

  const applyPromotionOutcome = useCallback((result: PromotionOutcome, action: PromotionAction) => {
    setOutcome(result);
    successTimerRef.current = setTimeout(() => {
      successTimerRef.current = null;
      if (mountedRef.current) setOutcome(null);
    }, PROMOTION_SUCCESS_MESSAGE_MS);

    // Promoting the ticked rows unticks what was added and keeps the rows the
    // server skipped for a retry; a whole-proposal promotion leaves the
    // selection alone.
    if (action === 'selected') {
      dispatchSelection({
        type: 'reconcile',
        created: result.createdKeywords,
        grouped: result.groupedKeywords,
        skipped: result.skippedKeywords,
      });
    }

    // A whole-proposal promotion also creates the unticked rows as inactive
    // keywords; only the active ones join the caller's keyword list.
    const createdActiveItems = action === 'proposal'
      ? result.createdItems.filter((item) => item.status === 'active')
      : result.createdItems;
    if (createdActiveItems.length > 0) onKeywordsAdded?.(createdActiveItems);
    requestKeywordReconciliation();
  }, [onKeywordsAdded, requestKeywordReconciliation]);

  const performPromotion = useCallback(async (
    requestedKeywords: PromoteKeywordEntry[],
    action: PromotionAction
  ): Promise<void> => {
    if (activeRequestRef.current !== null) return;

    const controller = new AbortController();
    // A later request, a cleared selection or an unmount supersedes this
    // request: whatever it settles with is dropped.
    const isSuperseded = () => activeRequestRef.current !== controller || !mountedRef.current;
    activeRequestRef.current = controller;
    setError(null);
    clearSuccessTimer();
    setOutcome(null);
    setSubmittingAction(action);

    const timeoutId = setTimeout(() => {
      controller.abort();
    }, PROMOTION_TIMEOUT_MS);
    requestTimerRef.current = timeoutId;

    try {
      const result = await promoteKeywords({
        keywords: requestedKeywords,
        groupIds,
        signal: controller.signal,
      });

      if (isSuperseded()) return;
      applyPromotionOutcome(result, action);
    } catch (requestError) {
      if (isSuperseded()) return;

      const failure = describePromotionFailure(requestError);
      setError(failure.message);
      if (failure.reconcile) requestKeywordReconciliation();
      console.error('[keywords] Error promoting keywords:', requestError);
    } finally {
      if (activeRequestRef.current === controller) {
        clearRequestTimer(timeoutId);
        activeRequestRef.current = null;
        if (mountedRef.current) setSubmittingAction(null);
      }
    }
  }, [
    groupIds,
    applyPromotionOutcome,
    clearRequestTimer,
    clearSuccessTimer,
    requestKeywordReconciliation,
  ]);

  const promote = useCallback(async (): Promise<void> => {
    if (activeRequestRef.current !== null) return;
    if (selected.length === 0) {
      setError(EMPTY_SELECTION_MESSAGE);
      return;
    }

    const requestedKeywords = selectedResearchKeywords(selected, availableUniqueKeywords);
    if (requestedKeywords === null) {
      dispatchSelection({
        type: 'retain',
        available: availableKeys,
      });
      setError(STALE_SELECTION_MESSAGE);
      return;
    }

    await performPromotion(requestedKeywords, 'selected');
  }, [selected, availableUniqueKeywords, availableKeys, performPromotion]);

  const promoteProposal = useCallback(async (): Promise<void> => {
    if (activeRequestRef.current !== null) return;
    if (availableUniqueKeywords.length === 0) {
      setError(EMPTY_PROPOSAL_MESSAGE);
      return;
    }

    // Every proposal row is promoted; the ticked ones as active keywords, the
    // rest as inactive ones.
    await performPromotion(availableUniqueKeywords.map((keyword) => ({
      ...keyword,
      status: selectedKeys.has(keywordSelectionKey(keyword.keyword)) ? 'active' : 'inactive',
    })), 'proposal');
  }, [availableUniqueKeywords, selectedKeys, performPromotion]);

  const submitting = submittingAction !== null;
  return {
    selectedKeys,
    selectedCount: selected.length,
    atLimit: selected.length === SELECTION_LIMIT,
    canPromote: selected.length > 0 && !submitting,
    canPromoteProposal: availableUniqueKeywords.length > 0 && !submitting,
    submitting,
    submittingAction,
    error,
    limitMessage,
    outcome,
    toggle,
    clearSelection,
    replaceSelection,
    promote,
    promoteProposal,
  };
};
