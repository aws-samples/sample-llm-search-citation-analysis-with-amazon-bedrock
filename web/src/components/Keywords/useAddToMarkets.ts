import {
  useCallback, useState
} from 'react';
import { apiPost } from '../../api/client';
import { suggestMarketKeywords } from '../../api/markets';
import { failureMessage } from '../../hooks/useMarkets';
import type {
  Keyword, MarketKeywordSuggestion
} from '../../types';
import {
  CREATE_ERROR_MESSAGE, getSafeErrorMessage, parseKeywordResponse
} from './keywordEntry';
import { localizedKeywordBody } from './keywordMarkets';

export type AddToMarketsPhase = 'pick' | 'suggesting' | 'review' | 'creating';

export interface AddToMarketsState {
  readonly phase: AddToMarketsPhase;
  /** The markets ticked for suggestions. */
  readonly picked: readonly string[];
  /** One editable keyword per market; a blank one is skipped. */
  readonly drafts: readonly MarketKeywordSuggestion[];
  readonly error: string | null;
}

const INITIAL: AddToMarketsState = {
  phase: 'pick',
  picked: [],
  drafts: [],
  error: null,
};

interface CreationResult {
  readonly created: Keyword[];
  readonly failures: string[];
}

/** Create each non-blank draft as a keyword of its market localizing `source`; failures are collected, not thrown. */
async function createLocalizedKeywords(source: Keyword, drafts: readonly MarketKeywordSuggestion[]): Promise<CreationResult> {
  const created: Keyword[] = [];
  const failures: string[] = [];
  for (const draft of drafts.filter((entry) => entry.keyword.trim() !== '')) {
    try {
      const response = await apiPost<unknown>('/keywords', localizedKeywordBody(draft.keyword, source, draft.market_id), { allowStructured4xx: true });
      created.push(parseKeywordResponse(response));
    } catch (error) {
      failures.push(`${draft.keyword.trim()} (${getSafeErrorMessage(error, CREATE_ERROR_MESSAGE)})`);
    }
  }
  return {
    created,
    failures,
  };
}

/**
 * The "Add to markets…" flow for one source keyword: tick markets, get the
 * keyword as a local user in each would type it (`POST /markets`), edit the
 * proposals, then create them as keywords of those markets that localize the
 * source (`concept_id`). The source keyword itself is never changed.
 */
export function useAddToMarkets(source: Keyword | null, onCreated: (created: Keyword[]) => void) {
  const [state, setState] = useState<AddToMarketsState>(INITIAL);
  const patch = (next: Partial<AddToMarketsState>) => setState((previous) => ({
    ...previous,
    ...next,
  }));

  const reset = useCallback(() => setState(INITIAL), []);

  const togglePicked = (marketId: string) => {
    setState((previous) => ({
      ...previous,
      picked: previous.picked.includes(marketId)
        ? previous.picked.filter((id) => id !== marketId)
        : [...previous.picked, marketId],
    }));
  };

  const suggest = async () => {
    if (source === null || state.picked.length === 0) return;
    patch({
      phase: 'suggesting',
      error: null,
    });
    try {
      const drafts = await suggestMarketKeywords(source.keyword, state.picked);
      patch({
        phase: 'review',
        drafts: drafts.filter((draft) => state.picked.includes(draft.market_id)),
      });
    } catch (error) {
      patch({
        phase: 'pick',
        error: failureMessage(error, 'Could not suggest keywords for these markets'),
      });
    }
  };

  const editDraft = (marketId: string, keyword: string) => {
    setState((previous) => ({
      ...previous,
      drafts: previous.drafts.map((draft) => (draft.market_id === marketId ? {
        market_id: marketId,
        keyword,
      } : draft)),
    }));
  };

  /** Create the drafts; `true` once every one was created (the flow is reset). */
  const create = async (): Promise<boolean> => {
    if (source === null) return false;
    patch({
      phase: 'creating',
      error: null,
    });
    const {
      created, failures
    } = await createLocalizedKeywords(source, state.drafts);
    if (created.length > 0) onCreated(created);
    if (failures.length === 0) {
      reset();
      return true;
    }
    const createdMarkets = new Set(created.map((keyword) => keyword.market_id));
    patch({
      phase: 'review',
      drafts: state.drafts.filter((draft) => !createdMarkets.has(draft.market_id)),
      error: `Not created: ${failures.join(', ')}`,
    });
    return false;
  };

  return {
    state,
    togglePicked,
    suggest,
    editDraft,
    create,
    reset,
  };
}
