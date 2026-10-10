import type { ReactNode } from 'react';
import { BrandExpansionPanel } from './BrandExpansionPanel';
import { BrandTagList } from './BrandTagList';
import type { BrandListSectionProps } from './brandListSection';

type BrandColorScheme = 'emerald' | 'amber';

interface SchemeClasses {
  readonly hint: string;
  readonly input: string;
  readonly add: string;
}

/** Spelled out per scheme because Tailwind only emits classes it can read whole from the source. */
const SCHEME_CLASSES: Record<BrandColorScheme, SchemeClasses> = {
  emerald: {
    hint: 'text-xs text-emerald-700 mb-3',
    input: 'flex-1 p-2 border border-emerald-300 rounded-lg focus:ring-2 focus:ring-emerald-500 bg-white text-sm',
    add: 'px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors text-sm',
  },
  amber: {
    hint: 'text-xs text-amber-700 mb-3',
    input: 'flex-1 p-2 border border-amber-300 rounded-lg focus:ring-2 focus:ring-amber-500 bg-white text-sm',
    add: 'px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors text-sm',
  },
};

/** The slice of a section's props the body renders; the section header keeps the expand-all controls. */
type BrandListState = Omit<BrandListSectionProps, 'expandingBrand' | 'canExpand' | 'onExpandAll'>;

interface BrandListBodyProps extends BrandListState {
  readonly target: 'first_party' | 'competitor';
  readonly colorScheme: BrandColorScheme;
  /** One-line instructions shown above the input. */
  readonly hint: string;
  readonly inputId: string;
  /** Accessible name of the "add brand" input. */
  readonly inputLabel: string;
  readonly placeholder: string;
  /** Further suggestion panels, shown between the expansion panel and the tag list. */
  readonly children?: ReactNode;
}

/**
 * Body shared by the first-party and competitor brand sections: the hint,
 * the "add brand" row, the sub-brand expansion panel for this list and the
 * brand tags.
 */
export function BrandListBody({
  brands, newBrand, selectedBrand, expansionResult, expansionTarget, pendingBrands,
  onNewBrandChange, onAddBrand, onRemoveBrand, onSelectBrand, onTogglePending, onAcceptExpansion, onCancelExpansion,
  target, colorScheme, hint, inputId, inputLabel, placeholder, children
}: BrandListBodyProps) {
  const classes = SCHEME_CLASSES[colorScheme];

  return (
    <>
      <p className={classes.hint}>{hint}</p>
      <div className="flex gap-2 mb-3">
        <input
          id={inputId}
          type="text"
          value={newBrand}
          onChange={(e) => onNewBrandChange(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onAddBrand()}
          placeholder={placeholder}
          aria-label={inputLabel}
          className={classes.input}
        />
        <button onClick={() => onAddBrand()} className={classes.add}>Add</button>
      </div>
      {expansionResult && expansionTarget === target && (
        <BrandExpansionPanel result={expansionResult} target={target} pendingBrands={pendingBrands} onToggleBrand={onTogglePending} onAccept={onAcceptExpansion} onCancel={onCancelExpansion} />
      )}
      {children}
      <BrandTagList brands={brands} selectedBrand={selectedBrand} colorScheme={colorScheme} onSelect={onSelectBrand} onRemove={onRemoveBrand} />
    </>
  );
}
