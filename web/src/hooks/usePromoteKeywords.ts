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
  useCallback, useReducer, useState 
} from 'react';
import { promoteKeywords } from '../api/keywords';
import type { PromotionOutcome } from '../api/keywords';
import {
  getErrorMessage, isAbortError 
} from '../infrastructure';
import type { ResearchKeyword } from '../types';

/** Maximum number of keywords that can be selected for one promotion. */
export const SELECTION_LIMIT = 500;

/** Time allowed for a promotion request before it is aborted. */
export const PROMOTION_TIMEOUT_MS = 30_000;

export const SELECTION_LIMIT_MESSAGE =
  `Selection limit reached: at most ${SELECTION_LIMIT} keywords can be promoted at once.`;

export const EMPTY_SELECTION_MESSAGE = 'Select at least one keyword to promote.';

export const PROMOTION_TIMEOUT_MESSAGE =
  'Promotion failed: the request did not complete within 30 seconds.';

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
  promote: (status: string, priority: string) => Promise<void>;
}

/**
 * Owns promotion selection and request state for a single research result view.
 *
 * `availableKeywords` are the research keyword rows currently on screen. They
 * are looked up by text when a promotion request is built so the research
 * context (`intent`, `competition`) reaches the backend `notes` field; a
 * selected text with no matching row falls back to a text-only record.
 */
export const usePromoteKeywords = (availableKeywords: ResearchKeyword[] = []): UsePromoteKeywords => {
  const [selectionState, dispatchSelection] = useReducer(reduceSelection, initialSelectionState);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<PromotionOutcome | null>(null);

  const {
    selected, limitMessage 
  } = selectionState;

  const toggle = useCallback((keyword: string) => {
    dispatchSelection({
      type: 'toggle',
      keyword,
    });
  }, []);

  const clearSelection = useCallback(() => {
    dispatchSelection({ type: 'clear' });
    setError(null);
    setOutcome(null);
  }, []);

  const promote = useCallback(async (status: string, priority: string): Promise<void> => {
    if (selected.length === 0) {
      setError(EMPTY_SELECTION_MESSAGE);
      return;
    }

    setError(null);
    setOutcome(null);
    setSubmitting(true);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
    }, PROMOTION_TIMEOUT_MS);

    try {
      const result = await promoteKeywords({
        keywords: selected.map((text) => findResearchKeyword(text, availableKeywords)),
        status,
        priority,
        signal: controller.signal,
      });

      setOutcome(result);
      dispatchSelection({
        type: 'reconcile',
        created: result.createdKeywords,
        skipped: result.skippedKeywords,
      });
    } catch (err) {
      // An abort surfaces here too; the selection is left untouched either way.
      setError(isAbortError(err)
        ? PROMOTION_TIMEOUT_MESSAGE
        : `Promotion failed: ${getErrorMessage(err, 'keywords')}`);
      console.error('[keywords] Error promoting keywords:', err);
    } finally {
      clearTimeout(timeoutId);
      setSubmitting(false);
    }
  }, [selected, availableKeywords]);

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
