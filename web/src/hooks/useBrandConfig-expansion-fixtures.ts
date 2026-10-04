import type { BrandConfigMockApiOptions } from './useBrandConfig-fixtures';
import type { useBrandConfig } from './useBrandConfig';

type BrandConfigHook = ReturnType<typeof useBrandConfig>;

interface GeneralFallbackExpansion {
  action: 'expandAllBrands' | 'findCompetitors';
  run: (hook: BrandConfigHook) => Promise<unknown>;
  /** Request body the API receives for `run`. */
  request: Record<string, unknown>;
}

export const GENERAL_ALL_BRANDS_EXPANSION = {
  action: 'expandAllBrands',
  run: (hook) => hook.expandAllBrands(['Brand1']),
  request: {
    existing_brands: ['Brand1'],
    industry: 'general',
    brand_type: 'first_party',
  },
} satisfies GeneralFallbackExpansion;

export const GENERAL_COMPETITOR_DISCOVERY = {
  action: 'findCompetitors',
  run: (hook) => hook.findCompetitors(['MyBrand']),
  request: {
    first_party_brands: ['MyBrand'],
    industry: 'general',
    existing_competitors: [],
  },
} satisfies GeneralFallbackExpansion;

/** Every expansion action, each falling back to the General industry. */
export const GENERAL_FALLBACK_EXPANSIONS: GeneralFallbackExpansion[] = [
  GENERAL_ALL_BRANDS_EXPANSION,
  GENERAL_COMPETITOR_DISCOVERY,
];

interface ExpansionArgumentRequest extends GeneralFallbackExpansion { argument: string }

/** Each expansion action called with its optional argument, and the request the API receives. */
export const EXPANSION_ARGUMENT_REQUESTS: ExpansionArgumentRequest[] = [
  {
    action: 'expandAllBrands',
    argument: 'brand type',
    run: (hook) => hook.expandAllBrands(['Brand1'], 'competitor'),
    request: {
      existing_brands: ['Brand1'],
      industry: 'hospitality',
      brand_type: 'competitor',
    },
  },
  {
    action: 'findCompetitors',
    argument: 'existing competitors',
    run: (hook) => hook.findCompetitors(['MyBrand'], ['ExistingCompetitor']),
    request: {
      first_party_brands: ['MyBrand'],
      industry: 'hospitality',
      existing_competitors: ['ExistingCompetitor'],
    },
  },
];

interface ExpansionOutcome {
  error?: string;
  suggestions?: string[];
  competitors?: string[];
}

interface ExpansionFailure {
  action: GeneralFallbackExpansion['action'];
  emptyField: 'suggestions' | 'competitors';
  failure: BrandConfigMockApiOptions;
  run: (hook: BrandConfigHook) => Promise<ExpansionOutcome>;
}

type ExpansionRun = (hook: BrandConfigHook) => Promise<ExpansionOutcome>;

export const expandBrand1: ExpansionRun = (hook) => hook.expandAllBrands(['Brand1']);
export const findMyBrandCompetitors: ExpansionRun = (hook) => hook.findCompetitors(['MyBrand']);

/** Each expansion action against a failing endpoint, and the list it must return empty. */
export const EXPANSION_FAILURES: ExpansionFailure[] = [
  {
    action: 'expandAllBrands',
    emptyField: 'suggestions',
    failure: { shouldFailExpandAll: true },
    run: expandBrand1,
  },
  {
    action: 'findCompetitors',
    emptyField: 'competitors',
    failure: { shouldFailFindCompetitors: true },
    run: findMyBrandCompetitors,
  },
];
