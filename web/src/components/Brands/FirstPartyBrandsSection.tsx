import { BrandListBody } from './BrandListBody';
import type { BrandListSectionProps } from './brandListSection';
import { ExpandBrandLabel } from './ExpandBrandLabel';

export function FirstPartyBrandsSection({
  expandingBrand, canExpand, onExpandAll, ...list
}: BrandListSectionProps) {
  const expanding = expandingBrand === 'first_party';

  return (
    <div className="bg-emerald-50 rounded-lg p-4 border border-emerald-200">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-emerald-800">First Party Brands</h3>
        {canExpand && list.brands.length > 0 && (
          <button
            onClick={onExpandAll}
            disabled={expanding}
            className="px-3 py-1.5 bg-emerald-600 text-white text-xs font-medium rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <ExpandBrandLabel expanding={expanding} />
          </button>
        )}
      </div>
      <BrandListBody
        {...list}
        target="first_party"
        colorScheme="emerald"
        hint='Your brands to track. Click a brand to select it, then use "Expand" to discover sub-brands.'
        inputId="new-first-party-brand"
        inputLabel="New first party brand"
        placeholder="Enter brand name..."
      />
    </div>
  );
}
