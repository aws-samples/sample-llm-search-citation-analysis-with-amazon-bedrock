import type { CompetitorDiscoveryResult } from '../../types';
import { CheckIcon } from '../ui';
import { SuggestionPanelHeader } from './SuggestionPanelHeader';

interface CompetitorDiscoveryPanelProps {
  readonly result: CompetitorDiscoveryResult;
  readonly existingCompetitors: string[];
  readonly pendingBrands: string[];
  readonly brandExists: (brand: string, list: string[]) => boolean;
  readonly onToggleBrand: (brand: string) => void;
  readonly onAccept: () => void;
  readonly onCancel: () => void;
}

export const CompetitorDiscoveryPanel = ({
  result,
  existingCompetitors,
  pendingBrands,
  brandExists,
  onToggleBrand,
  onAccept,
  onCancel,
}: CompetitorDiscoveryPanelProps) => {
  const getButtonClass = (brand: string) => {
    const isAlreadyAdded = brandExists(brand, existingCompetitors);
    const isSelected = pendingBrands.includes(brand);
    if (isAlreadyAdded) return 'bg-gray-100 text-gray-400 cursor-not-allowed';
    if (isSelected) return 'bg-amber-600 text-white';
    return 'bg-amber-100 text-amber-700 hover:bg-amber-200';
  };

  return (
    <div className="mb-4 p-3 bg-white rounded-lg border border-amber-300">
      <SuggestionPanelHeader
        title="Competitors for your brands"
        titleClassName="text-amber-800"
        notes={result.notes}
        notesClassName="text-amber-600"
        onDismiss={onCancel}
      />
      <p className="text-xs text-gray-500 mb-2">Select competitors to track (none selected by default):</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {result.competitors.map((brand) => {
          const isAlreadyAdded = brandExists(brand, existingCompetitors);
          return (
            <button
              key={brand}
              onClick={() => !isAlreadyAdded && onToggleBrand(brand)}
              disabled={isAlreadyAdded}
              className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm transition-colors ${getButtonClass(brand)}`}
            >
              {brand}
              {isAlreadyAdded && <CheckIcon className="w-3.5 h-3.5" title="Already added" />}
            </button>
          );
        })}
      </div>
      <div className="flex gap-2">
        <button onClick={onAccept} disabled={pendingBrands.length === 0} className="px-4 py-2 bg-amber-600 text-white text-sm font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50">
          Add {pendingBrands.length} Selected
        </button>
        <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">Cancel</button>
      </div>
    </div>
  );
};
