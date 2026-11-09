import {
  useState, useLayoutEffect, useCallback, useMemo
} from 'react';
import type {
  BrandConfig, IndustryPresets, BrandExpansionAllResult, CompetitorDiscoveryResult
} from '../types';
import { resolveBrandIndustryPreset } from '../constants/brandConfigDefaults';
import type { CompetitorDomains } from '../api/competitorDomainsDecoders';
import {
  configFromValues, defaultPromptOf, formValuesFromConfig, initialPromptOf, normalizeBrand,
  type BrandConfigFormValues
} from './brandConfigFormValues';

interface BrandConfigFormState extends BrandConfigFormValues {
  currentPrompt: string;
  promptModified: boolean;
}

interface BrandConfigFormInputs {
  newFirstParty: string;
  newFirstPartyDomain: string;
  newCompetitor: string;
  newEntityType: string;
}

type BrandType = 'first_party' | 'competitor';

interface BrandConfigExpansionState {
  expandingBrand: BrandType | null;
  expansionAllResult: BrandExpansionAllResult | null;
  competitorDiscoveryResult: CompetitorDiscoveryResult | null;
  /** Domains "Find competitors" suggested per competitor; offered unsaved until the admin picks them. */
  suggestedCompetitorDomains: CompetitorDomains;
  pendingExpansionBrands: string[];
  expansionTarget: BrandType | null;
}

export interface UseBrandConfigFormReturn {
  // Form state
  form: BrandConfigFormState;
  inputs: BrandConfigFormInputs;
  expansion: BrandConfigExpansionState;
  ui: {
    saving: boolean;
    saved: boolean;
    /** The form differs from the stored config, so there is something to save or discard. */
    dirty: boolean;
  };

  // Form setters
  setIndustry: (v: string) => void;
  setFirstPartyBrands: (v: string[]) => void;
  setFirstPartyDomains: (v: string[]) => void;
  setCompetitorBrands: (v: string[]) => void;
  setCompetitorDomains: (v: CompetitorDomains) => void;
  setCustomEntityTypes: (v: string[]) => void;
  setIncludeSentiment: (v: boolean) => void;
  setIncludeRankingContext: (v: boolean) => void;
  setMaxBrands: (v: number) => void;

  // Input setters
  setNewFirstParty: (v: string) => void;
  setNewFirstPartyDomain: (v: string) => void;
  setNewCompetitor: (v: string) => void;
  setNewEntityType: (v: string) => void;

  // Expansion setters
  setExpandingBrand: (v: BrandType | null) => void;
  setExpansionAllResult: (v: BrandExpansionAllResult | null) => void;
  setCompetitorDiscoveryResult: (v: CompetitorDiscoveryResult | null) => void;
  setSuggestedCompetitorDomains: (v: CompetitorDomains) => void;
  setPendingExpansionBrands: (v: string[]) => void;
  setExpansionTarget: (v: BrandType | null) => void;

  // Actions
  handlePromptChange: (newPrompt: string) => void;
  resetPromptToDefault: () => void;
  buildConfig: () => BrandConfig;
  /** Puts every field back to the stored config and clears the typed drafts. */
  discardChanges: () => void;
  /** Takes `saved` as the new baseline for `ui.dirty`, until the stored config changes. */
  markSaved: (saved: BrandConfig) => void;
  setSaving: (v: boolean) => void;
  setSaved: (v: boolean) => void;

  // Utilities
  brandExists: (brand: string, brandList: string[]) => boolean;
  currentPreset: IndustryPresets[string] | undefined;
}

export function useBrandConfigForm(
  config: BrandConfig | null,
  presets: IndustryPresets | null
): UseBrandConfigFormReturn {
  // UI state
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Form data state
  const initialValues = formValuesFromConfig(config);
  const [industry, setIndustry] = useState(initialValues.industry);
  const [firstPartyBrands, setFirstPartyBrands] = useState(initialValues.firstPartyBrands);
  const [firstPartyDomains, setFirstPartyDomains] = useState(initialValues.firstPartyDomains);
  const [competitorBrands, setCompetitorBrands] = useState(initialValues.competitorBrands);
  const [competitorDomains, setCompetitorDomains] = useState(initialValues.competitorDomains);
  const [customEntityTypes, setCustomEntityTypes] = useState(initialValues.customEntityTypes);
  const [includeSentiment, setIncludeSentiment] = useState(initialValues.includeSentiment);
  const [includeRankingContext, setIncludeRankingContext] = useState(initialValues.includeRankingContext);
  const [maxBrands, setMaxBrands] = useState(initialValues.maxBrands);
  const [industryPrompts, setIndustryPrompts] = useState(initialValues.industryPrompts);
  const [currentPrompt, setCurrentPrompt] = useState(() => initialPromptOf(initialValues, presets));
  const [promptModified, setPromptModified] = useState(false);

  // Input fields state
  const [newFirstParty, setNewFirstParty] = useState('');
  const [newFirstPartyDomain, setNewFirstPartyDomain] = useState('');
  const [newCompetitor, setNewCompetitor] = useState('');
  const [newEntityType, setNewEntityType] = useState('');

  // Expansion state
  const [expandingBrand, setExpandingBrand] = useState<BrandType | null>(null);
  const [expansionAllResult, setExpansionAllResult] = useState<BrandExpansionAllResult | null>(null);
  const [competitorDiscoveryResult, setCompetitorDiscoveryResult] = useState<CompetitorDiscoveryResult | null>(null);
  const [suggestedCompetitorDomains, setSuggestedCompetitorDomains] = useState<CompetitorDomains>({});
  const [pendingExpansionBrands, setPendingExpansionBrands] = useState<string[]>([]);
  const [expansionTarget, setExpansionTarget] = useState<BrandType | null>(null);

  const currentPreset = resolveBrandIndustryPreset(presets, industry);

  const brandExists = useCallback((brand: string, brandList: string[]): boolean =>
    brandList.some(existing => normalizeBrand(existing) === normalizeBrand(brand)), []);

  const applyValues = useCallback((values: BrandConfigFormValues) => {
    setIndustry(values.industry);
    setFirstPartyBrands(values.firstPartyBrands);
    setFirstPartyDomains(values.firstPartyDomains);
    setCompetitorBrands(values.competitorBrands);
    setCompetitorDomains(values.competitorDomains);
    setCustomEntityTypes(values.customEntityTypes);
    setIncludeSentiment(values.includeSentiment);
    setIncludeRankingContext(values.includeRankingContext);
    setMaxBrands(values.maxBrands);
    setIndustryPrompts(values.industryPrompts);
  }, []);

  // Sync form state when config changes. A layout effect, so the form never
  // paints one frame of stale values (which would flash the unsaved-changes bar).
  useLayoutEffect(() => {
    if (config) applyValues(formValuesFromConfig(config));
  }, [config, applyValues]);

  // Sync prompt when industry changes
  useLayoutEffect(() => {
    const customPrompt = industry in industryPrompts ? industryPrompts[industry] : undefined;
    setCurrentPrompt(customPrompt ?? defaultPromptOf(presets, industry));
    setPromptModified(customPrompt !== undefined);
  }, [industry, industryPrompts, presets]);

  const handlePromptChange = useCallback((newPrompt: string) => {
    setCurrentPrompt(newPrompt);
    setPromptModified(newPrompt !== defaultPromptOf(presets, industry));
  }, [presets, industry]);

  const resetPromptToDefault = useCallback(() => {
    setIndustryPrompts(prev => Object.fromEntries(Object.entries(prev).filter(([key]) => key !== industry)));
  }, [industry]);

  const values: BrandConfigFormValues = {
    industry,
    firstPartyBrands,
    firstPartyDomains,
    competitorBrands,
    competitorDomains,
    customEntityTypes,
    includeSentiment,
    includeRankingContext,
    maxBrands,
    industryPrompts,
  };
  const built = configFromValues(values, currentPrompt, presets);
  const buildConfig = () => built;

  const pristine = useMemo(() => {
    const stored = formValuesFromConfig(config);
    return JSON.stringify(configFromValues(stored, initialPromptOf(stored, presets), presets));
  }, [config, presets]);
  // What was last saved, until the stored config catches up (or the owner never updates it).
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  useLayoutEffect(() => { setSavedSnapshot(null); }, [config]);
  const markSaved = useCallback((savedConfig: BrandConfig) => setSavedSnapshot(JSON.stringify(savedConfig)), []);
  const dirty = JSON.stringify(built) !== (savedSnapshot ?? pristine);

  const discardChanges = () => {
    applyValues(formValuesFromConfig(config));
    setNewFirstParty('');
    setNewFirstPartyDomain('');
    setNewCompetitor('');
    setNewEntityType('');
  };

  return {
    setCompetitorDomains,
    setSuggestedCompetitorDomains,
    form: {
      ...values,
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
      expandingBrand,
      expansionAllResult,
      competitorDiscoveryResult,
      suggestedCompetitorDomains,
      pendingExpansionBrands,
      expansionTarget
    },
    ui: {
      saving,
      saved,
      dirty
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
    setSaving,
    setSaved,
    setExpandingBrand,
    setExpansionAllResult,
    setCompetitorDiscoveryResult,
    setPendingExpansionBrands,
    setExpansionTarget,
    handlePromptChange,
    resetPromptToDefault,
    buildConfig,
    discardChanges,
    markSaved,
    brandExists,
    currentPreset,
  };
}
