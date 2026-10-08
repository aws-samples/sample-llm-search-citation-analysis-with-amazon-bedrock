import {
  GLOBAL_MARKET_ID, type Market
} from '../../types';
import { NO_MARKET_LABEL } from './marketSelection';
import { useMarketSelection } from './marketSelectionContext';

interface Props {
  /** Prefix of the checkbox ids, unique on the page. */
  readonly idPrefix: string;
  /** The markets the scope is narrowed to (empty = every market). */
  readonly selectedIds: readonly string[];
  readonly onChange: (marketIds: string[]) => void;
  readonly disabled?: boolean;
}

interface MarketOption {
  readonly id: string;
  readonly label: string;
}

function filterOptions(markets: readonly Market[], includeUnassigned: boolean): MarketOption[] {
  return [
    ...markets.map((market) => ({
      id: market.market_id,
      label: market.name,
    })),
    ...(includeUnassigned ? [{
      id: GLOBAL_MARKET_ID,
      label: NO_MARKET_LABEL,
    }] : []),
  ];
}

/**
 * Which markets a run or schedule covers, on top of its keyword scope: none
 * ticked means every market. Rendered only once a market is configured.
 */
export function MarketScopeFilter({
  idPrefix, selectedIds, onChange, disabled = false
}: Props) {
  const {
    catalog, hasUnassignedKeywords
  } = useMarketSelection();
  if (catalog.markets.length === 0) return null;
  const options = filterOptions(catalog.markets, hasUnassignedKeywords);
  const selected = new Set(selectedIds);
  const toggle = (id: string) => {
    onChange(options.map((option) => option.id).filter((optionId) => (optionId === id ? !selected.has(id) : selected.has(optionId))));
  };

  return (
    <fieldset className="border-0 p-0 m-0">
      <legend className="text-sm font-medium text-gray-700 mb-1">Markets</legend>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {options.map((option) => {
          const checkboxId = `${idPrefix}-market-${option.id}`;
          return (
            <label key={option.id} htmlFor={checkboxId} className="inline-flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
              <input
                id={checkboxId}
                type="checkbox"
                checked={selected.has(option.id)}
                onChange={() => toggle(option.id)}
                disabled={disabled}
                className="w-4 h-4 text-gray-900 rounded border-gray-300 focus:ring-gray-900"
              />
              {option.label}
            </label>
          );
        })}
      </div>
      <p className="text-xs text-gray-400 mt-1">
        {selected.size === 0 ? 'Every market (none ticked).' : 'Only keywords of the ticked markets run.'}
      </p>
    </fieldset>
  );
}
