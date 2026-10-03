import { Spinner } from '../ui/Spinner';
import { BrandExpansionPanel } from './BrandExpansionPanel';
import { BrandTagList } from './BrandTagList';
import type { BrandListSectionProps } from './brandListSection';
import { StrokeIcon } from '../ui/StrokeIcon';
import { BOLT_PATHS } from '../ui/iconPaths';

export function FirstPartyBrandsSection({
  brands, newBrand, selectedBrand, expandingBrand, expansionResult, expansionTarget,
  pendingBrands, canExpand, onNewBrandChange, onAddBrand, onRemoveBrand, onSelectBrand,
  onExpandAll, onTogglePending, onAcceptExpansion, onCancelExpansion
}: BrandListSectionProps) {
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
              <><StrokeIcon className="w-3 h-3" paths={BOLT_PATHS} strokeWidth={2} />Expand Brand</>
            )}
          </button>
        )}
      </div>
      <p className="text-xs text-emerald-700 mb-3">Your brands to track. Click a brand to select it, then use "Expand" to discover sub-brands.</p>
      <div className="flex gap-2 mb-3">
        <input
          id="new-first-party-brand"
          type="text"
          value={newBrand}
          onChange={(e) => onNewBrandChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddBrand()}
          placeholder="Enter brand name..."
          aria-label="New first party brand"
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
