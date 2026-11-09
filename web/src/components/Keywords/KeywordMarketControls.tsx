import {
  GLOBAL_MARKET_ID, type Keyword, type Market
} from '../../types';
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
  /** A short visible word before the select (e.g. "in") while the full label stays its accessible name. */
  readonly prefix?: string;
}

/** One `<option>` per configured market, valued by its id. */
export const MarketOptions = ({ markets }: { readonly markets: readonly Market[] }) => (
  <>{markets.map((market) => <option key={market.market_id} value={market.market_id}>{market.name}</option>)}</>
);

/** The market a new or edited keyword is asked from. */
export function KeywordMarketSelect({
  id, label, value, markets, onChange, disabled = false, hideLabel = false, prefix
}: KeywordMarketSelectProps) {
  return (
    <span className="inline-flex items-center gap-2">
      {prefix && <span aria-hidden="true" className="text-sm text-gray-500">{prefix}</span>}
      <label htmlFor={id} className={hideLabel || prefix ? 'sr-only' : 'text-sm text-gray-600'}>{label}</label>
      <select id={id} value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled}
        className="py-2 pl-3 pr-8 max-w-48 border border-gray-200 rounded-lg text-sm bg-white focus:outline-hidden focus:ring-2 focus:ring-gray-900">
        <option value="">No market</option>
        <MarketOptions markets={markets} />
      </select>
    </span>
  );
}

interface KeywordMarketCellProps {
  readonly keyword: Keyword;
  readonly controls: KeywordMarketControls;
  /** Whether the translations list (under the keyword) is open. */
  readonly translationsOpen: boolean;
  readonly onToggleTranslations: () => void;
  /** The id of that list, for `aria-controls`. */
  readonly translationsId: string;
}

/**
 * A keyword row's market, as plain text with the country and language in its
 * tooltip, and "+N" when translations ask the same question in N other
 * markets. "+N" opens the list under the keyword.
 */
export function KeywordMarketCell({
  keyword, controls, translationsOpen, onToggleTranslations, translationsId
}: KeywordMarketCellProps) {
  const marketId = keywordMarketId(keyword);
  const market = controls.markets.find((candidate) => candidate.market_id === marketId);
  const linkedCount = linkedKeywords(keyword, controls.allKeywords).length;
  const label = marketName(marketId, controls.markets);
  return (
    <span className="flex items-center gap-1.5 min-w-0">
      {marketId === GLOBAL_MARKET_ID
        ? <span className="text-gray-500" title="No market: asked without a country or language">—</span>
        : <span className="truncate text-gray-700" title={market ? `Market ${label}: ${market.country_name}, ${market.language_name}` : `Market ${label}`}>{label}</span>}
      {linkedCount > 0 && (
        <button
          type="button"
          aria-expanded={translationsOpen}
          aria-controls={translationsId}
          aria-label={`Also asked in ${linkedCount} ${linkedCount === 1 ? 'market' : 'markets'}`}
          title={`Also asked in ${linkedCount} ${linkedCount === 1 ? 'market' : 'markets'}`}
          onClick={onToggleTranslations}
          className="shrink-0 px-1.5 rounded-sm text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 focus:outline-hidden focus-visible:ring-2 focus-visible:ring-gray-900"
        >
          +{linkedCount}
        </button>
      )}
    </span>
  );
}

interface KeywordTranslationListProps {
  readonly keyword: Keyword;
  readonly controls: KeywordMarketControls;
  readonly open: boolean;
  readonly id: string;
}

/** "Also asked as <text> (<market>), …" under a keyword; rendered hidden until "+N" opens it. */
export function KeywordTranslationList({
  keyword, controls, open, id
}: KeywordTranslationListProps) {
  const linked = linkedKeywords(keyword, controls.allKeywords);
  if (linked.length === 0) return null;
  return (
    <span id={id} hidden={!open} className={`${open ? 'block' : 'hidden'} mt-1 text-xs text-gray-500 whitespace-normal break-words`}>
      Also asked as{' '}
      {linked.map((other, index) => (
        <span key={other.id}>
          {index > 0 && ', '}
          <q>{other.keyword}</q> ({marketName(keywordMarketId(other), controls.markets)})
        </span>
      ))}
    </span>
  );
}
