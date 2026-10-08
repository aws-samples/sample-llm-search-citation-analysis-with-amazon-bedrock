import {
  useCallback, useEffect, useMemo, useState, type ReactNode
} from 'react';
import {
  useLocation, useSearchParams
} from 'react-router-dom';
import { useMarkets } from '../../hooks/useMarkets';
import type { Keyword } from '../../types';
import {
  applicableMarketChoice,
  decodeMarketChoice,
  hasUnassignedKeywords,
  MARKET_SEARCH_PARAM,
  marketChoiceOptions,
  readStoredMarketChoice,
  storeMarketChoice,
  type MarketChoice,
} from './marketSelection';
import {
  MARKET_SELECTION_CONTEXT, type MarketSelectionValue
} from './marketSelectionContext';

interface Props {
  /** Every keyword, to know whether "No market" is a choice. */
  readonly keywords: readonly Keyword[];
  readonly children: ReactNode;
}

function isReportPath(pathname: string): boolean {
  return pathname.startsWith('/reports');
}

/** `search` with the market parameter set to `choice` (removed for every market combined). */
function withMarketParam(search: URLSearchParams, choice: MarketChoice): URLSearchParams {
  const next = new URLSearchParams(search);
  if (choice === null) next.delete(MARKET_SEARCH_PARAM);
  else next.set(MARKET_SEARCH_PARAM, choice);
  return next;
}

/**
 * The app-wide market choice of the header selector. It is remembered in
 * `localStorage` and, on report pages, carried in `?market=` so a shared
 * link or a `?print=1` tab shows the same market: a report URL naming a
 * market wins over the remembered choice, and a report opened without one
 * gets the current choice written into its URL.
 */
export function MarketSelectionProvider({
  keywords, children
}: Props) {
  const catalog = useMarkets();
  const { pathname } = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const onReport = isReportPath(pathname);
  const linked = onReport ? searchParams.get(MARKET_SEARCH_PARAM) : null;
  const [stored, setStored] = useState<MarketChoice>(() => (linked === null ? readStoredMarketChoice() : decodeMarketChoice(linked)));
  const unassigned = useMemo(() => hasUnassignedKeywords(keywords), [keywords]);
  const requested = linked === null ? stored : decodeMarketChoice(linked);
  const selectedMarketId = applicableMarketChoice(requested, catalog.markets, catalog.loaded, unassigned);

  // A report link that names a market becomes the remembered choice.
  useEffect(() => {
    if (linked === null) return;
    const choice = decodeMarketChoice(linked);
    setStored(choice);
    storeMarketChoice(choice);
  }, [linked]);

  // A report opened without a market carries the current one from now on.
  useEffect(() => {
    if (onReport && linked === null && selectedMarketId !== null) {
      setSearchParams((previous) => withMarketParam(previous, selectedMarketId), { replace: true });
    }
  }, [onReport, linked, selectedMarketId, setSearchParams]);

  const selectMarket = useCallback((choice: MarketChoice) => {
    setStored(choice);
    storeMarketChoice(choice);
    if (onReport) setSearchParams((previous) => withMarketParam(previous, choice), { replace: true });
  }, [onReport, setSearchParams]);

  const value = useMemo<MarketSelectionValue>(() => ({
    catalog,
    selectedMarketId,
    selectMarket,
    options: marketChoiceOptions(catalog.markets, unassigned),
    hasUnassignedKeywords: unassigned,
  }), [catalog, selectedMarketId, selectMarket, unassigned]);

  return <MARKET_SELECTION_CONTEXT.Provider value={value}>{children}</MARKET_SELECTION_CONTEXT.Provider>;
}
