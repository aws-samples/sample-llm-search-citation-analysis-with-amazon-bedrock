import { Spinner } from '../ui/Spinner';
import { BrandListBody } from './BrandListBody';
import { CompetitorDiscoveryPanel } from './CompetitorDiscoveryPanel';
import type {
  BrandExpansionAllResult, CompetitorDiscoveryResult 
} from '../../types';
import type { BrandListSectionProps } from './brandListSection';
import { StrokeIcon } from '../ui/StrokeIcon';
import { SEARCH_PATHS } from '../ui/iconPaths';
import { ExpandBrandLabel } from './ExpandBrandLabel';

interface CompetitorBrandsSectionProps extends BrandListSectionProps {
  readonly discoveryResult: CompetitorDiscoveryResult | null;
  readonly hasFirstPartyBrands: boolean;
  readonly canFindCompetitors: boolean;
  readonly brandExists: (brand: string, list: string[]) => boolean;
  readonly onFindCompetitors: () => void;
}

interface CompetitorActionsProps {
  readonly hasBrands: boolean;
  readonly expanding: boolean;
  readonly expansionResult: BrandExpansionAllResult | null;
  readonly discoveryResult: CompetitorDiscoveryResult | null;
  readonly canExpand: boolean;
  readonly canFindCompetitors: boolean;
  readonly onExpandAll: () => void;
  readonly onFindCompetitors: () => void;
}

/** The "Find Competitors" and "Expand Brand" buttons; each spins while its own request runs. */
function CompetitorActions({
  hasBrands, expanding, expansionResult, discoveryResult, canExpand, canFindCompetitors, onExpandAll, onFindCompetitors
}: CompetitorActionsProps) {
  const finding = expanding && !discoveryResult && !expansionResult;
  const expandingAll = expanding && expansionResult !== null;
  return (
    <div className="flex gap-2">
      {canFindCompetitors && (
        <button
          onClick={onFindCompetitors}
          disabled={expanding}
          className="px-3 py-1.5 bg-amber-100 text-amber-700 text-xs font-medium rounded-lg hover:bg-amber-200 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          {finding ? <><Spinner size="sm" />Finding...</> : (
            <><StrokeIcon className="w-3 h-3" paths={SEARCH_PATHS} strokeWidth={2} />Find Competitors</>
          )}
        </button>
      )}
      {canExpand && hasBrands && (
        <button
          onClick={onExpandAll}
          disabled={expanding}
          className="px-3 py-1.5 bg-amber-600 text-white text-xs font-medium rounded-lg hover:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
        >
          <ExpandBrandLabel expanding={expandingAll} />
        </button>
      )}
    </div>
  );
}

export function CompetitorBrandsSection({
  expandingBrand, discoveryResult, hasFirstPartyBrands, canExpand, canFindCompetitors, brandExists,
  onExpandAll, onFindCompetitors, ...list
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
        <CompetitorActions
          hasBrands={list.brands.length > 0}
          expanding={expandingBrand === 'competitor'}
          expansionResult={list.expansionResult}
          discoveryResult={discoveryResult}
          canExpand={canExpand}
          canFindCompetitors={canFindCompetitors}
          onExpandAll={onExpandAll}
          onFindCompetitors={onFindCompetitors}
        />
      </div>
      <BrandListBody
        {...list}
        target="competitor"
        colorScheme="amber"
        hint='Click a competitor to select it, then use "Expand Brand" to discover their sub-brands.'
        inputId="new-competitor-brand"
        inputLabel="New competitor brand"
        placeholder="Enter competitor name..."
      >
        {discoveryResult && list.expansionTarget === 'competitor' && (
          <CompetitorDiscoveryPanel result={discoveryResult} existingCompetitors={list.brands} pendingBrands={list.pendingBrands} brandExists={brandExists} onToggleBrand={list.onTogglePending} onAccept={list.onAcceptExpansion} onCancel={list.onCancelExpansion} />
        )}
      </BrandListBody>
    </div>
  );
}
