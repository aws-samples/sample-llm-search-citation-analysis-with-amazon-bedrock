/**
 * Result shapes returned by the brand-config expansion and discovery hooks
 * (`useBrandConfig`), shared with the Brands components that render them.
 * The raw HTTP response shapes stay private to the hook.
 */

/**
 * Result from expanding a single brand.
 * Contains suggested sub-brands and variations.
 */
export interface BrandExpansionResult {
  /** The main brand that was expanded */
  main_brand: string;
  /** Parent company if identified */
  parent_company?: string | null;
  /** Suggested sub-brands and variations */
  suggestions: string[];
  /** Additional notes about the expansion */
  notes?: string;
  /** Error message if expansion failed */
  error?: string;
}

/**
 * Result from expanding all tracked brands.
 * Contains suggestions for missing sub-brands across all brands.
 */
export interface BrandExpansionAllResult {
  /** Original list of brands */
  existing_brands: string[];
  /** Identified parent companies */
  parent_companies?: string[];
  /** Suggested brands to add */
  suggestions: string[];
  /** Duplicates found in the existing list */
  duplicates_found: Array<{
    brand: string;
    duplicate_of: string;
    reason: string;
  }>;
  /** Additional notes */
  notes?: string;
  /** Error message if expansion failed */
  error?: string;
}

/**
 * Result from competitor discovery.
 * Contains suggested competitors based on first-party brands.
 */
export interface CompetitorDiscoveryResult {
  /** First-party brands used for discovery */
  first_party_brands: string[];
  /** Discovered competitor brands */
  competitors: string[];
  /** Additional notes about the discovery */
  notes?: string;
  /** Error message if discovery failed */
  error?: string;
}
