import type { BrandExpansionAllResult } from '../../types';

type BrandListKind = 'first_party' | 'competitor';

/**
 * State and callbacks shared by the first-party and competitor brand list
 * sections: the tag list, the "add brand" input and the sub-brand expansion
 * panel. `BrandConfigContent` owns the state and hands one slice per list.
 */
export interface BrandListSectionProps {
  readonly brands: string[];
  readonly newBrand: string;
  readonly selectedBrand: string | null;
  readonly expandingBrand: BrandListKind | null;
  readonly expansionResult: BrandExpansionAllResult | null;
  readonly expansionTarget: BrandListKind | null;
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
