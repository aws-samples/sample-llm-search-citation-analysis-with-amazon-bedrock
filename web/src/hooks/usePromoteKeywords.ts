/**
 * Promotion selection and request state for research keywords.
 *
 * The selection is keyed by keyword TEXT, matching the `selected?: Set<string>`
 * prop and `key={kw.keyword}` rows of the research result tables. It is exposed
 * here as a `string[]`; callers that need set membership build a `Set` from it.
 *
 * `reduceSelection` below is a pure function exported from source so tests
 * import selection logic instead of reimplementing it.
 */
import {
  useCallback, useEffect, useReducer, useRef, useState 
} from 'react';
import { promoteKeywords } from '../api/keywords';
import type { PromotionOutcome } from '../api/keywords';
import {
  getErrorMessage, isAbortError 
} from '../infrastructure';
import type {
  Keyword, ResearchKeyword 
} from '../types';

/** Maximum number of keywords that can be selected for one promotion. */
export const SELECTION_LIMIT = 500;

/** Time allowed for a promotion request before it is aborted. */
export const PROMOTION_TIMEOUT_MS = 30_000;

/** How long the success message stays on screen before it dismisses itself. */
export const PROMOTION_SUCCESS_MESSAGE_MS = 5_000;

export const SELECTION_LIMIT_MESSAGE =
  `Selection limit reached: at most ${SELECTION_LIMIT} keywords can be added at once.`;

export const EMPTY_SELECTION_MESSAGE = 'Select at least one keyword to add.';

export const PROMOTION_TIMEOUT_MESSAGE =
  'Adding keywords failed: the request did not complete within 30 seconds.';

/**
 * The transient success line shown after a promotion, e.g. `3 keywords added`
 * or `3 keywords added, 2 already existed`. Exported so the component and its
 * tests read the same wording from source.
 */
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
  if (state.selected.includes(keyword)) {
    return {
      selected: state.selected.filter((text) => text !== keyword),
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
    selected: [...state.selected, keyword],
    limitMessage: null,
  };
}

function reconcileSelection(
  state: SelectionState,
  created: string[],
  skipped: string[]
): SelectionState {
  const createdTexts = new Set(created);
  const retainedTexts = new Set(skipped.filter((text) => !createdTexts.has(text)));

  return {
    selected: state.selected.filter((text) => retainedTexts.has(text)),
    limitMessage: null,
  };
}

/**
 * Pure selection reducer.
 *
 * `toggle` removes an already-selected keyword, adds an unselected one below
 * the limit, and rejects an add at the limit (selection unchanged, limit
 * message set). `clear` empties the selection. `reconcile` drops the created
 * texts and retains the skipped ones; anything selected that appears in neither
 * list is dropped as well.
 *
 * `skipped` carries duplicate-reason texts only — `promoteKeywords()` filtered
 * empty-reason entries out upstream — so this reducer never inspects a wire
 * `reason` field.
 */
export function reduceSelection(state: SelectionState, action: SelectionAction): SelectionState {
  switch (action.type) {
    case 'toggle':
      return toggleSelection(state, action.keyword);
    case 'clear':
      return initialSelectionState;
    case 'reconcile':
      return reconcileSelection(state, action.created, action.skipped);
    default:
      return state;
  }
}

function findResearchKeyword(text: string, availableKeywords: ResearchKeyword[]): ResearchKeyword {
  const match = availableKeywords.find((candidate) => candidate.keyword === text);

  return match ?? {
    keyword: text,
    intent: '',
    competition: '',
    relevance: 0,
  };
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

/**
 * Owns promotion selection and request state for a single research result view.
 *
 * `availableKeywords` are the research keyword rows currently on screen. They
 * are looked up by text when a promotion request is built so the research
 * context (`intent`, `competition`) reaches the backend `notes` field; a
 * selected text with no matching row falls back to a text-only record.
 *
 * `onKeywordsAdded` is called with the complete created keywords after a
 * successful request, so the owning view can insert them into the active
 * keyword list without a refetch. The hook stays ignorant of where that list
 * lives.
 *
 * The request deliberately omits `status` and `priority`: the backend resolves
 * omitted values to `active` / `normal`, so the defaults are documented in one
 * place instead of being restated here.
 */
export const usePromoteKeywords = (
  availableKeywords: ResearchKeyword[] = [],
  onKeywordsAdded?: (created: Keyword[]) => void
): UsePromoteKeywords => {
  const [selectionState, dispatchSelection] = useReducer(reduceSelection, initialSelectionState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PromotionOutcome | null>(null);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    selected, limitMessage 
  } = selectionState;

  const clearSuccessTimer = useCallback(() => {
    if (successTimerRef.current !== null) {
      clearTimeout(successTimerRef.current);
      successTimerRef.current = null;
    }
  }, []);

  // The success message dismisses itself on a timer, so the timer is cleared on
  // unmount: it must never fire against a gone component.
  useEffect(() => clearSuccessTimer, [clearSuccessTimer]);

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
  }, [clearSuccessTimer]);

  const promote = useCallback(async (): Promise<void> => {
    if (selected.length === 0) {
      setError(EMPTY_SELECTION_MESSAGE);
      return;
    }

    setError(null);
    clearSuccessTimer();
    setOutcome(null);
    setSubmitting(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, PROMOTION_TIMEOUT_MS);

    try {
      const result = await promoteKeywords({
        keywords: selected.map((text) => findResearchKeyword(text, availableKeywords)),
        signal: controller.signal,
      });

      setOutcome(result);
      successTimerRef.current = setTimeout(() => {
        successTimerRef.current = null;
        setOutcome(null);
      }, PROMOTION_SUCCESS_MESSAGE_MS);

      dispatchSelection({
        type: 'reconcile',
        created: result.createdKeywords,
        skipped: result.skippedKeywords,
      });

      if (result.createdItems.length > 0) {
        onKeywordsAdded?.(result.createdItems);
      }
    } catch (err) {
      // An abort surfaces here too; the selection is left untouched either way.
      setError(isAbortError(err)
        ? PROMOTION_TIMEOUT_MESSAGE
        : `Adding keywords failed: ${getErrorMessage(err, 'keywords')}`);
      console.error('[keywords] Error promoting keywords:', err);
    } finally {
      clearTimeout(timeoutId);
      setSubmitting(false);
    }
  }, [selected, availableKeywords, onKeywordsAdded, clearSuccessTimer]);

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
