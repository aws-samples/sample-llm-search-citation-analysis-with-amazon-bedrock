import type {
  BrandConfig, IndustryPresets 
} from '../domain/brands';

/** Response from GET /brand-config */
export type BrandConfigResponse = BrandConfig;

/** Response from GET /brand-config/presets */
export interface PresetsResponse {presets: IndustryPresets;}

/** Response from POST /brand-config/expand */
export interface ExpandBrandResponse {
  main_brand: string;
  parent_company?: string | null;
  suggestions?: string[];
  notes?: string;
  error?: string;
}

/** Response from POST /brand-config/expand-all */
export interface ExpandAllBrandsResponse {
  existing_brands?: string[];
  parent_companies?: string[];
  suggestions?: string[];
  duplicates_found?: Array<{
    brand: string;
    duplicate_of: string;
    reason: string;
  }>;
  notes?: string;
  error?: string;
}

/** Response from POST /brand-config/find-competitors */
export interface FindCompetitorsResponse {
  first_party_brands: string[];
  competitors?: string[];
  notes?: string;
  error?: string;
}

/** Result from expanding a single brand */
export interface BrandExpansionResult {
  main_brand: string;
  parent_company?: string | null;
  suggestions: string[];
  notes?: string;
  error?: string;
}

/** Result from expanding all tracked brands */
export interface BrandExpansionAllResult {
  existing_brands: string[];
  parent_companies?: string[];
  suggestions: string[];
  duplicates_found: Array<{
    brand: string;
    duplicate_of: string;
    reason: string;
  }>;
  notes?: string;
  error?: string;
}

/** Result from competitor discovery */
export interface CompetitorDiscoveryResult {
  first_party_brands: string[];
  competitors: string[];
  notes?: string;
  error?: string;
}
