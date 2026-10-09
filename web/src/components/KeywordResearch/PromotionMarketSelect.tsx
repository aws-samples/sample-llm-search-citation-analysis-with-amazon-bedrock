import type { PromotionMarket } from '../../hooks/usePromotionMarket';
import { NO_MARKET_LABEL } from '../Markets/marketSelection';

interface PromotionMarketSelectProps {
  /** Unique on the page (one picker per research result). */
  readonly id: string;
  readonly market: PromotionMarket;
  readonly disabled?: boolean;
}

/** The market the added keywords are created in; rendered only once a market is configured. */
export function PromotionMarketSelect({
  id, market, disabled = false
}: PromotionMarketSelectProps) {
  if (market.markets.length === 0) return null;
  return (
    <div className="w-full sm:w-56">
      <label htmlFor={id} className="block text-xs text-gray-600 mb-1">Market for new keywords</label>
      <select
        id={id}
        value={market.marketId ?? ''}
        onChange={(event) => market.choose(event.target.value === '' ? null : event.target.value)}
        disabled={disabled}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900"
      >
        <option value="">{NO_MARKET_LABEL}</option>
        {market.markets.map((option) => (
          <option key={option.market_id} value={option.market_id}>{option.name}</option>
        ))}
      </select>
    </div>
  );
}
