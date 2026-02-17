import type { BrandExpansionAllResult } from '../../hooks/useBrandConfig';

interface BrandExpansionPanelProps {
  readonly result: BrandExpansionAllResult;
  readonly target: 'first_party' | 'competitor';
  readonly pendingBrands: string[];
  readonly onToggleBrand: (brand: string) => void;
  readonly onAccept: () => void;
  readonly onCancel: () => void;
}

export const BrandExpansionPanel = ({
  result,
  target,
  pendingBrands,
  onToggleBrand,
  onAccept,
  onCancel,
}: BrandExpansionPanelProps) => {
  const isFirstParty = target === 'first_party';
  const colorScheme = isFirstParty
    ? {
      border: 'border-emerald-300',
      text: 'text-emerald-800',
      subtext: 'text-emerald-600',
      bg: 'bg-emerald-600',
      bgHover: 'hover:bg-emerald-700',
      bgLight: 'bg-emerald-100',
      textLight: 'text-emerald-700',
      bgLightHover: 'hover:bg-emerald-200',
    }
    : {
      border: 'border-amber-300',
      text: 'text-amber-800',
      subtext: 'text-amber-600',
      bg: 'bg-amber-600',
      bgHover: 'hover:bg-amber-700',
      bgLight: 'bg-amber-100',
      textLight: 'text-amber-700',
      bgLightHover: 'hover:bg-amber-200',
    };

  const duplicatesBg = isFirstParty ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';
  const duplicatesText = isFirstParty ? 'text-amber-800' : 'text-red-800';
  const duplicatesSubtext = isFirstParty ? 'text-amber-700' : 'text-red-700';

  return (
    <div className={`mb-4 p-3 bg-white rounded-lg border ${colorScheme.border}`}>
      <div className="flex items-start justify-between mb-2">
        <div>
          <h4 className={`text-sm font-medium ${colorScheme.text}`}>
            Missing sub-brands for {isFirstParty ? 'your' : 'competitor'} brands
          </h4>
          {result.parent_companies && result.parent_companies.length > 0 && (
            <p className={`text-xs ${colorScheme.subtext} mt-1`}>
              Parent companies: {result.parent_companies.join(', ')}
            </p>
          )}
          {result.notes && (
            <p className="text-xs text-gray-500 mt-1">{result.notes}</p>
          )}
        </div>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      {result.duplicates_found && result.duplicates_found.length > 0 && (
        <div className={`mb-3 p-2 ${duplicatesBg} border rounded-lg`}>
          <p className={`text-xs font-medium ${duplicatesText} mb-1`}>⚠️ Potential duplicates in your list:</p>
          <ul className={`text-xs ${duplicatesSubtext} space-y-1`}>
            {result.duplicates_found.map((dup) => (
              <li key={`${dup.brand}-${dup.duplicate_of}`}>
                "{dup.brand}" may be duplicate of "{dup.duplicate_of}"
              </li>
            ))}
          </ul>
        </div>
      )}

      {result.suggestions.length > 0 ? (
        <>
          <p className="text-xs text-gray-500 mb-2">Select brands to add:</p>
          <div className="flex flex-wrap gap-2 mb-3">
            {result.suggestions.map((brand) => {
              const isSelected = pendingBrands.includes(brand);
              return (
                <button
                  key={brand}
                  onClick={() => onToggleBrand(brand)}
                  className={`px-3 py-1 rounded-full text-sm transition-colors ${
                    isSelected ? `${colorScheme.bg} text-white` : `${colorScheme.bgLight} ${colorScheme.textLight} ${colorScheme.bgLightHover}`
                  }`}
                >
                  {brand}
                </button>
              );
            })}
          </div>
          <div className="flex gap-2">
            <button
              onClick={onAccept}
              disabled={pendingBrands.length === 0}
              className={`px-4 py-2 ${colorScheme.bg} text-white text-sm font-medium rounded-lg ${colorScheme.bgHover} transition-colors disabled:opacity-50`}
            >
              Add {pendingBrands.length} Selected
            </button>
            <button onClick={onCancel} className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors">
              Cancel
            </button>
          </div>
        </>
      ) : (
        <p className={`text-sm ${colorScheme.subtext} italic`}>No missing sub-brands found - your list looks complete!</p>
      )}
    </div>
  );
};
