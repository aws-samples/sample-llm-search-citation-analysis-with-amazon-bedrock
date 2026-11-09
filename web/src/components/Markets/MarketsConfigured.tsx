import type { ReactNode } from 'react';
import { useMarketSelection } from './marketSelectionContext';

/** Renders its children only once a market is configured: the market controls mean nothing without one. */
export function MarketsConfigured({ children }: { readonly children: ReactNode }) {
  const { catalog } = useMarketSelection();
  if (catalog.markets.length === 0) return null;
  return <>{children}</>;
}
