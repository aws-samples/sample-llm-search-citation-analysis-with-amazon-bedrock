import { Spinner } from '../ui/Spinner';
import { BrandExpansionPanel } from './BrandExpansionPanel';
import { BrandTagList } from './BrandTagList';
import type { BrandExpansionAllResult } from '../../types';

interface FirstPartyBrandsSectionProps {
  readonly brands: string[];
  readonly newBrand: string;
  readonly selectedBrand: string | null;
  readonly expandingBrand: 'first_party' | 'competitor' | null;
  readonly expansionResult: BrandExpansionAllResult | null;
  readonly expansionTarget: 'first_party' | 'competitor' | null;
  readonly pendingBrands: string[];
  readonly canExpand: boolean;
  readonly onNewBrandChange: (value: string) => void;
  readonly onAddBrand: () => void;
  readonly onRemoveBrand: (brand: string) => void;
  readonly onSelectBrand: (brand: string | null) => void;
  readonly onExpandAll: () => void;
  readonly onTogglePending: (brand: string) => void;
  readonly onAcceptExpansion: () => void;
  readonly onCancelExpansion: () => void;
}

export function FirstPartyBrandsSection({
  brands, newBrand, selectedBrand, expandingBrand, expansionResult, expansionTarget,
  pendingBrands, canExpand, onNewBrandChange, onAddBrand, onRemoveBrand, onSelectBrand,
  onExpandAll, onTogglePending, onAcceptExpansion, onCancelExpansion
}: FirstPartyBrandsSectionProps) {
  return (
    <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-emerald-800">First Party Brands</h3>
        {canExpand && brands.length > 0 && (
          <button
            onClick={onExpandAll}
            disabled={expandingBrand === 'first_party'}
            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            {expandingBrand === 'first_party' ? <><Spinner size="sm" />Expanding...</> : (
              <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Expand Brand</>
            )}
          </button>
        )}
      </div>
      <p className="text-xs text-emerald-700 mb-3">Your brands to track. Click a brand to select it, then use "Expand" to discover sub-brands.</p>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={newBrand}
          onChange={(e) => onNewBrandChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddBrand()}
          placeholder="Enter brand name..."
          className="flex-1 p-2 border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm"
        />
        <button onClick={onAddBrand} className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm">Add</button>
      </div>
      {expansionResult && expansionTarget === 'first_party' && (
        <BrandExpansionPanel result={expansionResult} target="first_party" pendingBrands={pendingBrands} onToggleBrand={onTogglePending} onAccept={onAcceptExpansion} onCancel={onCancelExpansion} />
      )}
      <BrandTagList brands={brands} selectedBrand={selectedBrand} colorScheme="emerald" onSelect={onSelectBrand} onRemove={onRemoveBrand} />
    </div>
  );
}
