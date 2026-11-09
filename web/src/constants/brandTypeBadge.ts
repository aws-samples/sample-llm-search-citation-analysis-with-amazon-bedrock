import type { BrandClassification } from '../types';

/**
 * The badge saying whose a brand is, the same on every page: violet for your brand, grey for competitors and
 * other brands, told apart by the label (design-system §2.2).
 */
// Stryker disable next-line ObjectLiteral: the badge palette is Tailwind-only; the classification label carries the meaning
export const BRAND_TYPE_BADGE: Readonly<Record<BrandClassification, string>> = {
  // Stryker disable next-line StringLiteral: badge colours are presentation-only
  first_party: 'bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200',
  // Stryker disable next-line StringLiteral: badge colours are presentation-only
  competitor: 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-100',
  // Stryker disable next-line StringLiteral: badge colours are presentation-only
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
};
