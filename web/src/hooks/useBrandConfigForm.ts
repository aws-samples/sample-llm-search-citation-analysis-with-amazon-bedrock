import {
  useState, useEffect, useCallback 
} from 'react';
import type {
  BrandConfig, IndustryPresets, BrandExpansionAllResult, CompetitorDiscoveryResult 
} from '../types';

export interface BrandConfigFormState {
  industry: string;
  firstPartyBrands: string[];
  firstPartyDomains: string[];
  competitorBrands: string[];
  customEntityTypes: string[];
  includeSentiment: boolean;
  includeRankingContext: boolean;
  maxBrands: number;
  industryPrompts: Record<string, string>;
  currentPrompt: string;
  promptModified: boolean;
}

export interface BrandConfigFormInputs {
  newFirstParty: string;
  newFirstPartyDomain: string;
  newCompetitor: string;
  newEntityType: string;
}

type BrandType = 'first_party' | 'competitor';
type ConfigTab = 'settings' | 'prompt';

export interface BrandConfigExpansionState {
  selectedFirstPartyBrand: string | null;
  selectedCompetitorBrand: string | null;
  expandingBrand: BrandType | null;
  expansionAllResult: BrandExpansionAllResult | null;
  competitorDiscoveryResult: CompetitorDiscoveryResult | null;
  pendingExpansionBrands: string[];
  expansionTarget: BrandType | null;
}

export interface UseBrandConfigFormReturn {
  // Form state
  form: BrandConfigFormState;
  inputs: BrandConfigFormInputs;
  expansion: BrandConfigExpansionState;
  ui: {
    activeTab: ConfigTab;
    saving: boolean;
    saved: boolean 
  };
  
  // Form setters
  setIndustry: (v: string) => void;
  setFirstPartyBrands: (v: string[]) => void;
  setFirstPartyDomains: (v: string[]) => void;
  setCompetitorBrands: (v: string[]) => void;
  setCustomEntityTypes: (v: string[]) => void;
  setIncludeSentiment: (v: boolean) => void;
  setIncludeRankingContext: (v: boolean) => void;
  setMaxBrands: (v: number) => void;
  
  // Input setters
  setNewFirstParty: (v: string) => void;
  setNewFirstPartyDomain: (v: string) => void;
  setNewCompetitor: (v: string) => void;
  setNewEntityType: (v: string) => void;
  
  // UI setters
  setActiveTab: (v: ConfigTab) => void;
  
  // Expansion setters
  setSelectedFirstPartyBrand: (v: string | null) => void;
  setSelectedCompetitorBrand: (v: string | null) => void;
  setExpandingBrand: (v: BrandType | null) => void;
  setExpansionAllResult: (v: BrandExpansionAllResult | null) => void;
  setCompetitorDiscoveryResult: (v: CompetitorDiscoveryResult | null) => void;
  setPendingExpansionBrands: (v: string[]) => void;
  setExpansionTarget: (v: BrandType | null) => void;
  
  // Actions
  handlePromptChange: (newPrompt: string) => void;
  resetPromptToDefault: () => void;
  buildConfig: () => BrandConfig;
  setSaving: (v: boolean) => void;
  setSaved: (v: boolean) => void;
  
  // Utilities
  normalizeBrand: (name: string) => string;
  brandExists: (brand: string, brandList: string[]) => boolean;
  currentPreset: IndustryPresets[string] | undefined;
}

export function useBrandConfigForm(
  config: BrandConfig | null,
  presets: IndustryPresets | null
): UseBrandConfigFormReturn {
  // UI state
  const [activeTab, setActiveTab] = useState<ConfigTab>('settings');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form data state
  const [industry, setIndustry] = useState(config?.industry ?? 'hotels');
  const [firstPartyBrands, setFirstPartyBrands] = useState<string[]>(config?.tracked_brands?.first_party ?? []);
  const [firstPartyDomains, setFirstPartyDomains] = useState<string[]>(config?.first_party_domains ?? []);
  const [competitorBrands, setCompetitorBrands] = useState<string[]>(config?.tracked_brands?.competitors ?? []);
  const [customEntityTypes, setCustomEntityTypes] = useState<string[]>(config?.custom_entity_types ?? []);
  const [includeSentiment, setIncludeSentiment] = useState(config?.include_sentiment ?? true);
  const [includeRankingContext, setIncludeRankingContext] = useState(config?.include_ranking_context ?? true);
  const [maxBrands, setMaxBrands] = useState(config?.max_brands ?? 20);
  const [industryPrompts, setIndustryPrompts] = useState<Record<string, string>>(config?.industry_prompts ?? {});
  const [currentPrompt, setCurrentPrompt] = useState('');
  const [promptModified, setPromptModified] = useState(false);

  // Input fields state
  const [newFirstParty, setNewFirstParty] = useState('');
  const [newFirstPartyDomain, setNewFirstPartyDomain] = useState('');
  const [newCompetitor, setNewCompetitor] = useState('');
  const [newEntityType, setNewEntityType] = useState('');

  // Expansion state
  const [selectedFirstPartyBrand, setSelectedFirstPartyBrand] = useState<string | null>(null);
  const [selectedCompetitorBrand, setSelectedCompetitorBrand] = useState<string | null>(null);
  const [expandingBrand, setExpandingBrand] = useState<'first_party' | 'competitor' | null>(null);
  const [expansionAllResult, setExpansionAllResult] = useState<BrandExpansionAllResult | null>(null);
  const [competitorDiscoveryResult, setCompetitorDiscoveryResult] = useState<CompetitorDiscoveryResult | null>(null);
  const [pendingExpansionBrands, setPendingExpansionBrands] = useState<string[]>([]);
  const [expansionTarget, setExpansionTarget] = useState<'first_party' | 'competitor' | null>(null);

  const currentPreset = presets?.[industry];

  const normalizeBrand = useCallback((name: string): string => 
    name.normalize('NFD').replaceAll(/[\u0300-\u036F]/gi, '').toLowerCase().trim(), []);

  const brandExists = useCallback((brand: string, brandList: string[]): boolean => 
    brandList.some(existing => normalizeBrand(existing) === normalizeBrand(brand)), [normalizeBrand]);

  // Sync form state when config changes
  useEffect(() => {
    if (config) {
      setIndustry(config.industry || 'hotels');
      setFirstPartyBrands(config.tracked_brands?.first_party ?? []);
      setFirstPartyDomains(config.first_party_domains ?? []);
      setCompetitorBrands(config.tracked_brands?.competitors ?? []);
      setCustomEntityTypes(config.custom_entity_types ?? []);
      setIncludeSentiment(config.include_sentiment ?? true);
      setIncludeRankingContext(config.include_ranking_context ?? true);
      setMaxBrands(config.max_brands ?? 20);
      setIndustryPrompts(config.industry_prompts ?? {});
    }
  }, [config]);

  // Sync prompt when industry changes
  useEffect(() => {
    const customPrompt = industry in industryPrompts ? industryPrompts[industry] : undefined;
    const defaultPrompt = presets?.[industry]?.default_prompt ?? '';
    setCurrentPrompt(customPrompt ?? defaultPrompt);
    setPromptModified(customPrompt !== undefined);
  }, [industry, industryPrompts, presets]);

  const handlePromptChange = useCallback((newPrompt: string) => {
    setCurrentPrompt(newPrompt);
    const defaultPrompt = presets?.[industry]?.default_prompt ?? '';
    setPromptModified(newPrompt !== defaultPrompt);
  }, [presets, industry]);

  const resetPromptToDefault = useCallback(() => {
    const defaultPrompt = presets?.[industry]?.default_prompt ?? '';
    setCurrentPrompt(defaultPrompt);
    setIndustryPrompts(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== industry)));
    setPromptModified(false);
  }, [presets, industry]);

  const buildConfig = useCallback((): BrandConfig => {
    const defaultPrompt = presets?.[industry]?.default_prompt ?? '';
    const finalPrompts = currentPrompt === defaultPrompt ? industryPrompts : {
      ...industryPrompts,
      [industry]: currentPrompt 
    };
    return {
      industry,
      tracked_brands: {
        first_party: firstPartyBrands,
        competitors: competitorBrands 
      },
      first_party_domains: firstPartyDomains,
      custom_entity_types: customEntityTypes,
      custom_prompt_additions: '',
      include_sentiment: includeSentiment,
      include_ranking_context: includeRankingContext,
      max_brands: maxBrands,
      extract_brands: true,
      industry_prompts: finalPrompts,
    };
  }, [industry, firstPartyBrands, competitorBrands, firstPartyDomains, customEntityTypes, includeSentiment, includeRankingContext, maxBrands, industryPrompts, currentPrompt, presets]);

  return {
    form: {
      industry,
      firstPartyBrands,
      firstPartyDomains,
      competitorBrands,
      customEntityTypes,
      includeSentiment,
      includeRankingContext,
      maxBrands,
      industryPrompts,
      currentPrompt,
      promptModified 
    },
    inputs: {
      newFirstParty,
      newFirstPartyDomain,
      newCompetitor,
      newEntityType 
    },
    expansion: {
      selectedFirstPartyBrand,
      selectedCompetitorBrand,
      expandingBrand,
      expansionAllResult,
      competitorDiscoveryResult,
      pendingExpansionBrands,
      expansionTarget 
    },
    ui: {
      activeTab,
      saving,
      saved 
    },
    setIndustry,
    setFirstPartyBrands,
    setFirstPartyDomains,
    setCompetitorBrands,
    setCustomEntityTypes,
    setIncludeSentiment,
    setIncludeRankingContext,
    setMaxBrands,
    setNewFirstParty,
    setNewFirstPartyDomain,
    setNewCompetitor,
    setNewEntityType,
    setActiveTab,
    setSaving,
    setSaved,
    setSelectedFirstPartyBrand,
    setSelectedCompetitorBrand,
    setExpandingBrand,
    setExpansionAllResult,
    setCompetitorDiscoveryResult,
    setPendingExpansionBrands,
    setExpansionTarget,
    handlePromptChange,
    resetPromptToDefault,
    buildConfig,
    normalizeBrand,
    brandExists,
    currentPreset,
  };
}
