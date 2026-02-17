import type { CompetitorDiscoveryResult } from '../../hooks/useBrandConfig';

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
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className="text-sm font-medium text-amber-800">Competitors for your brands</h4>
          {result.notes && (
            <p className="text-xs text-amber-600 mt-1">{result.notes}</p>
          )}
        </div>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <p className="text-xs text-gray-500 mb-2">Select competitors to track (none selected by default):</p>
      <div className="flex flex-wrap gap-2 mb-3">
        {result.competitors.map((brand) => {
          const isAlreadyAdded = brandExists(brand, existingCompetitors);
          return (
            <button
              key={brand}
              onClick={() => !isAlreadyAdded && onToggleBrand(brand)}
              disabled={isAlreadyAdded}
              className={`px-3 py-1 rounded-full text-sm transition-colors ${getButtonClass(brand)}`}
            >
              {isAlreadyAdded ? `${brand} ✓` : brand}
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
