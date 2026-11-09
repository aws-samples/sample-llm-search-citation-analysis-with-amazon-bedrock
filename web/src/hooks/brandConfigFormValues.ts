/**
 * The editable values of the Brand Tracking form and the pure rules between
 * them and a stored `BrandConfig`: reading a config into values, building the
 * config to save, and the prompt a value set starts with.
 */
import type {
  BrandConfig, IndustryPresets
} from '../types';
import {
  DEFAULT_BRAND_INDUSTRY, resolveBrandIndustryPreset
} from '../constants/brandConfigDefaults';
import {
  decodeCompetitorDomains, type CompetitorDomains
} from '../api/competitorDomainsDecoders';
import { domainsOfCompetitors } from './competitorDomains';

/** The stored part of the form; the prompt fields derive from it and the presets. */
export interface BrandConfigFormValues {
  industry: string;
  firstPartyBrands: string[];
  firstPartyDomains: string[];
  competitorBrands: string[];
  /** Saved (and newly confirmed) domains per competitor. */
  competitorDomains: CompetitorDomains;
  customEntityTypes: string[];
  includeSentiment: boolean;
  includeRankingContext: boolean;
  maxBrands: number;
  industryPrompts: Record<string, string>;
}

function defaultFormValues(): BrandConfigFormValues {
  return {
    industry: DEFAULT_BRAND_INDUSTRY,
    firstPartyBrands: [],
    firstPartyDomains: [],
    competitorBrands: [],
    competitorDomains: {},
    customEntityTypes: [],
    includeSentiment: true,
    includeRankingContext: true,
    maxBrands: 20,
    industryPrompts: {},
  };
}

/** A brand name compared case-, accent- and surrounding-whitespace-insensitively. */
export function normalizeBrand(name: string): string {
  return name.normalize('NFD').replaceAll(/[\u0300-\u036F]/gi, '').toLowerCase().trim();
}

function trackedBrandsFromConfig(
  config: BrandConfig,
  defaults: BrandConfigFormValues
): Pick<BrandConfigFormValues, 'firstPartyBrands' | 'competitorBrands'> {
  return {
    firstPartyBrands: config.tracked_brands?.first_party ?? defaults.firstPartyBrands,
    competitorBrands: config.tracked_brands?.competitors ?? defaults.competitorBrands,
  };
}

/** Editable values of a stored config; gaps in a partial config fall back to the defaults. */
export function formValuesFromConfig(config: BrandConfig | null): BrandConfigFormValues {
  const defaults = defaultFormValues();
  if (!config) return defaults;
  return {
    industry: config.industry || defaults.industry,
    ...trackedBrandsFromConfig(config, defaults),
    firstPartyDomains: config.first_party_domains ?? defaults.firstPartyDomains,
    competitorDomains: decodeCompetitorDomains(config.competitor_domains),
    customEntityTypes: config.custom_entity_types ?? defaults.customEntityTypes,
    includeSentiment: config.include_sentiment ?? defaults.includeSentiment,
    includeRankingContext: config.include_ranking_context ?? defaults.includeRankingContext,
    maxBrands: config.max_brands ?? defaults.maxBrands,
    industryPrompts: config.industry_prompts ?? defaults.industryPrompts,
  };
}

/** The preset prompt of `industry`, or an empty prompt when the presets do not know it. */
export function defaultPromptOf(presets: IndustryPresets | null, industry: string): string {
  return resolveBrandIndustryPreset(presets, industry)?.default_prompt ?? '';
}

/** The prompt the editor shows for `values`: the saved custom prompt of the industry, else its preset. */
export function initialPromptOf(values: BrandConfigFormValues, presets: IndustryPresets | null): string {
  const custom = values.industry in values.industryPrompts ? values.industryPrompts[values.industry] : undefined;
  return custom ?? defaultPromptOf(presets, values.industry);
}

/** The config to save: `values`, with `currentPrompt` kept as the industry's prompt when it differs from the preset. */
export function configFromValues(
  values: BrandConfigFormValues,
  currentPrompt: string,
  presets: IndustryPresets | null
): BrandConfig {
  const finalPrompts = currentPrompt === defaultPromptOf(presets, values.industry) ? values.industryPrompts : {
    ...values.industryPrompts,
    [values.industry]: currentPrompt
  };
  return {
    industry: values.industry,
    tracked_brands: {
      first_party: values.firstPartyBrands,
      competitors: values.competitorBrands
    },
    first_party_domains: values.firstPartyDomains,
    competitor_domains: domainsOfCompetitors(values.competitorDomains, values.competitorBrands),
    custom_entity_types: values.customEntityTypes,
    custom_prompt_additions: '',
    include_sentiment: values.includeSentiment,
    include_ranking_context: values.includeRankingContext,
    max_brands: values.maxBrands,
    extract_brands: true,
    industry_prompts: finalPrompts,
  };
}
