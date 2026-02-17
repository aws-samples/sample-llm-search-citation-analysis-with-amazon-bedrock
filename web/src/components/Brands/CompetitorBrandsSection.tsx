import { Spinner } from '../ui/Spinner';
import { BrandExpansionPanel } from './BrandExpansionPanel';
import { CompetitorDiscoveryPanel } from './CompetitorDiscoveryPanel';
import { BrandTagList } from './BrandTagList';
import type {
  BrandExpansionAllResult, CompetitorDiscoveryResult 
} from '../../types';

interface CompetitorBrandsSectionProps {
  readonly brands: string[];
  readonly newBrand: string;
  readonly selectedBrand: string | null;
  readonly expandingBrand: 'first_party' | 'competitor' | null;
  readonly expansionResult: BrandExpansionAllResult | null;
  readonly discoveryResult: CompetitorDiscoveryResult | null;
  readonly expansionTarget: 'first_party' | 'competitor' | null;
  readonly pendingBrands: string[];
  readonly hasFirstPartyBrands: boolean;
  readonly canExpand: boolean;
  readonly canFindCompetitors: boolean;
  readonly brandExists: (brand: string, list: string[]) => boolean;
  readonly onNewBrandChange: (value: string) => void;
  readonly onAddBrand: () => void;
  readonly onRemoveBrand: (brand: string) => void;
  readonly onSelectBrand: (brand: string | null) => void;
  readonly onExpandAll: () => void;
  readonly onFindCompetitors: () => void;
  readonly onTogglePending: (brand: string) => void;
  readonly onAcceptExpansion: () => void;
  readonly onCancelExpansion: () => void;
}

export function CompetitorBrandsSection({
  brands, newBrand, selectedBrand, expandingBrand, expansionResult, discoveryResult, expansionTarget,
  pendingBrands, hasFirstPartyBrands, canExpand, canFindCompetitors, brandExists,
  onNewBrandChange, onAddBrand, onRemoveBrand, onSelectBrand, onExpandAll, onFindCompetitors,
  onTogglePending, onAcceptExpansion, onCancelExpansion
}: CompetitorBrandsSectionProps) {
  if (!hasFirstPartyBrands) {
    return (
      <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
        <h3 className="text-sm font-semibold text-amber-800 mb-2">Competitor Brands</h3>
        <div className="text-center py-4">
          <p className="text-sm text-amber-700">Add first-party brands first to discover competitors</p>
        </div>
      </div>
    );
  }

  return (
    <div className="bg-amber-50 rounded-lg p-4 border border-amber-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-amber-800">Competitor Brands</h3>
        <div className="flex gap-2">
          {canFindCompetitors && (
            <button
              onClick={onFindCompetitors}
              disabled={expandingBrand === 'competitor'}
              className="px-3 py-1.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-lg hover:bg-amber-200 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {expandingBrand === 'competitor' && !discoveryResult && !expansionResult ? <><Spinner size="sm" />Finding...</> : (
                <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" /></svg>Find Competitors</>
              )}
            </button>
          )}
          {canExpand && brands.length > 0 && (
            <button
              onClick={onExpandAll}
              disabled={expandingBrand === 'competitor'}
              className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            >
              {expandingBrand === 'competitor' && expansionResult ? <><Spinner size="sm" />Expanding...</> : (
                <><svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" /></svg>Expand Brand</>
              )}
            </button>
          )}
        </div>
      </div>
      <p className="text-xs text-amber-700 mb-3">Click a competitor to select it, then use "Expand Brand" to discover their sub-brands.</p>
      <div className="flex gap-2 mb-3">
        <input
          type="text"
          value={newBrand}
          onChange={(e) => onNewBrandChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddBrand()}
          placeholder="Enter competitor name..."
          className="flex-1 p-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white text-sm"
        />
        <button onClick={onAddBrand} className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm">Add</button>
      </div>
      {expansionResult && expansionTarget === 'competitor' && (
        <BrandExpansionPanel result={expansionResult} target="competitor" pendingBrands={pendingBrands} onToggleBrand={onTogglePending} onAccept={onAcceptExpansion} onCancel={onCancelExpansion} />
      )}
      {discoveryResult && expansionTarget === 'competitor' && (
        <CompetitorDiscoveryPanel result={discoveryResult} existingCompetitors={brands} pendingBrands={pendingBrands} brandExists={brandExists} onToggleBrand={onTogglePending} onAccept={onAcceptExpansion} onCancel={onCancelExpansion} />
      )}
      <BrandTagList brands={brands} selectedBrand={selectedBrand} colorScheme="amber" onSelect={onSelectBrand} onRemove={onRemoveBrand} />
    </div>
  );
}
