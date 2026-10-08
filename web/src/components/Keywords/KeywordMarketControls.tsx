import {
  GLOBAL_MARKET_ID, type Keyword, type Market
} from '../../types';
import { MarketBadge } from '../Markets/MarketBadge';
import {
  keywordMarketId, marketName
} from '../Markets/marketSelection';
import { linkedKeywords } from './keywordMarkets';

/** What the keyword list needs to show and edit markets; absent while no market is configured. */
export interface KeywordMarketControls {
  readonly markets: readonly Market[];
  /** Every keyword (not only the filtered ones), to find each keyword's translations. */
  readonly allKeywords: readonly Keyword[];
  /** The market picked in the row being edited (`''` = no market). */
  readonly editMarketId: string;
  readonly setEditMarketId: (marketId: string) => void;
  /** Opens "Add to markets…" for a keyword; absent for users who cannot create translations. */
  readonly onAddToMarkets?: (keyword: Keyword) => void;
}

interface KeywordMarketSelectProps {
  readonly id: string;
  readonly label: string;
  /** `''` = no market (the global one). */
  readonly value: string;
  readonly markets: readonly Market[];
  readonly onChange: (marketId: string) => void;
  readonly disabled?: boolean;
  /** Visually hide the label (dense rows); it stays the select's accessible name. */
  readonly hideLabel?: boolean;
}

/** The market a new or edited keyword is asked from. */
export function KeywordMarketSelect({
  id, label, value, markets, onChange, disabled = false, hideLabel = false
}: KeywordMarketSelectProps) {
  return (
    <span className="inline-flex items-center gap-2">
      <label htmlFor={id} className={hideLabel ? 'sr-only' : 'text-sm text-gray-600'}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
        className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-gray-900">
        <option value="">No market</option>
        {markets.map((market) => <option key={market.market_id} value={market.market_id}>{market.name}</option>)}
      </select>
    </span>
  );
}

interface KeywordMarketInfoProps {
  readonly keyword: Keyword;
  readonly controls: KeywordMarketControls;
}

/** A keyword row's market badge and the markets its translations are asked in. */
export function KeywordMarketInfo({
  keyword, controls
}: KeywordMarketInfoProps) {
  const marketId = keywordMarketId(keyword);
  const linked = linkedKeywords(keyword, controls.allKeywords);
  return (
    <>
      {marketId !== GLOBAL_MARKET_ID && <MarketBadge marketId={marketId} markets={controls.markets} />}
      {linked.length > 0 && (
        <span className="text-xs text-gray-500">
          Also asked as{' '}
          {linked.map((other, index) => (
            <span key={other.id}>
              {index > 0 && ', '}
              <q>{other.keyword}</q> ({marketName(keywordMarketId(other), controls.markets)})
            </span>
          ))}
        </span>
      )}
    </>
  );
}

interface AddToMarketsButtonProps {
  readonly keyword: Keyword;
  readonly controls: KeywordMarketControls;
}

export function AddToMarketsButton({
  keyword, controls
}: AddToMarketsButtonProps) {
  const { onAddToMarkets } = controls;
  if (onAddToMarkets === undefined) return null;
  return (
    <button
      type="button"
      onClick={() => onAddToMarkets(keyword)}
      aria-label={`Add ${keyword.keyword} to markets`}
      className="px-2 py-1 text-xs text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded border border-gray-200"
    >
      Add to markets…
    </button>
  );
}
