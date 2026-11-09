import type { BrandExpansionAllResult } from '../../types';

/**
 * State and callbacks shared by the "Your brand" and "Competitors" sections:
 * the brand list with its draft, and the "Suggest sub-brands" request with its
 * picked suggestions. `BrandConfigContent` owns the state and hands one slice
 * per section.
 */
export interface BrandListSectionProps {
  readonly brands: string[];
  readonly newBrand: string;
  readonly expansionResult: BrandExpansionAllResult | null;
  readonly pendingBrands: string[];
  readonly canExpand: boolean;
  readonly onNewBrandChange: (value: string) => void;
  readonly onAddBrand: () => void;
  readonly onRemoveBrand: (brand: string) => void;
  readonly onExpandAll: () => void;
  readonly onTogglePending: (brand: string) => void;
  readonly onAcceptExpansion: () => void;
  readonly onCancelExpansion: () => void;
}
