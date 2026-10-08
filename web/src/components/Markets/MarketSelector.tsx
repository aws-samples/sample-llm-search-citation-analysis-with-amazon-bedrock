import { useId } from 'react';
import {
  decodeMarketChoice, encodeMarketChoice
} from './marketSelection';
import { useMarketSelection } from './marketSelectionContext';

/**
 * The header's market picker: every view and report that reads a keyword
 * group or all keywords narrows to the chosen market. Rendered only once a
 * market is configured; the header leaves it out in print mode.
 */
export function MarketSelector() {
  const id = useId();
  const {
    catalog, options, selectedMarketId, selectMarket
  } = useMarketSelection();
  if (catalog.markets.length === 0) return null;

  return (
    <div className="flex items-center gap-2 print-hidden">
      <label htmlFor={id} className="sr-only">Market</label>
      <select
        id={id}
        value={encodeMarketChoice(selectedMarketId)}
        onChange={(event) => selectMarket(decodeMarketChoice(event.target.value))}
        title="Market the views and reports cover"
        className="max-w-[12rem] sm:max-w-[16rem] truncate rounded-lg border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 px-2 py-1.5 text-sm text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-gray-900"
      >
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </div>
  );
}
