import type { Market } from '../../types';
import { marketName } from './marketSelection';

interface Props {
  readonly marketId: string;
  readonly markets: readonly Market[];
}

/** The market a keyword (or an alert) belongs to, named; rendered only for a configured market. */
export function MarketBadge({
  marketId, markets
}: Props) {
  const market = markets.find((candidate) => candidate.market_id === marketId);
  const label = marketName(marketId, markets);
  return (
    <span
      className="px-1.5 py-0.5 text-xs rounded border border-sky-200 bg-sky-50 text-sky-700"
      title={market === undefined ? `Market ${label}` : `Market ${label}: ${market.country_name}, ${market.language_name}`}
    >
      <span className="sr-only">Market: </span>
      {label}
    </span>
  );
}
