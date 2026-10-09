import { useState } from 'react';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import type { Keyword } from '../../types';
import { useMarketSelection } from '../Markets/marketSelectionContext';
import type { KeywordMarketControls } from './KeywordMarketControls';

/**
 * The keyword manager's market state: the market new keywords are asked
 * from, the market of the row being edited and the keyword "Add to
 * markets…" is open for. `controls` is `undefined` while no market is
 * configured, so the list looks exactly as before markets existed.
 */
export function useKeywordMarketState(allKeywords: readonly Keyword[]) {
  const { catalog } = useMarketSelection();
  // POST /markets (the suggestions) is Admin-only; others are not offered the action.
  const { isAdmin } = useIsAdmin();
  const [newMarketId, setNewMarketId] = useState('');
  const [editMarketId, setEditMarketId] = useState('');
  const [marketSource, setMarketSource] = useState<Keyword | null>(null);
  const { markets } = catalog;
  const controls: KeywordMarketControls | undefined = markets.length === 0 ? undefined : {
    markets,
    allKeywords,
    editMarketId,
    setEditMarketId,
    ...(isAdmin ? { onAddToMarkets: setMarketSource } : {}),
  };

  return {
    markets,
    newMarketId,
    setNewMarketId,
    editMarketId,
    setEditMarketId,
    marketSource,
    setMarketSource,
    controls,
  };
}
