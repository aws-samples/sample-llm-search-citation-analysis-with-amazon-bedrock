import { useState } from 'react';
import type {
  BrandConfig, IndustryPresets, BrandExpansionAllResult, CompetitorDiscoveryResult
} from '../../types';
import { useBrandConfigForm } from '../../hooks/useBrandConfigForm';
import { mergeSuggestedDomains } from '../../hooks/competitorDomains';
import { normalizeDomain } from '../../formatting/domainIdentity';

type BrandType = 'first_party' | 'competitor';

export interface BrandConfigEditorOptions {
  readonly config: BrandConfig | null;
  readonly presets: IndustryPresets | null;
  readonly onSave: (config: BrandConfig) => Promise<void>;
  readonly onExpandAllBrands?: (brands: string[], type: BrandType) => Promise<BrandExpansionAllResult>;
  readonly onFindCompetitors?: (firstPartyBrands: string[], existingCompetitors: string[]) => Promise<CompetitorDiscoveryResult>;
  readonly onSaveComplete?: () => void;
}

/** A trimmed value added to `list` unless it is empty or already there (by `exists`); `null` when nothing changes. */
function withValue(list: string[], raw: string, exists: (value: string, list: string[]) => boolean): string[] | null {
  const value = raw.trim();
  return value && !exists(value, list) ? [...list, value] : null;
}

/**
 * The Brand Tracking form state (`useBrandConfigForm`) with the actions the
 * form's controls call: adding values from the drafts, the Bedrock suggestion
 * requests and their accept/cancel, save and discard.
 */
export function useBrandConfigEditor({
  config, presets, onSave, onExpandAllBrands, onFindCompetitors, onSaveComplete
}: BrandConfigEditorOptions) {
  const state = useBrandConfigForm(config, presets);
  const [saveFailed, setSaveFailed] = useState(false);
  const {
    form, inputs, expansion, brandExists,
  } = state;
  const includes = (value: string, list: string[]) => list.includes(value);

  const addFirstPartyBrand = () => {
    const next = withValue(form.firstPartyBrands, inputs.newFirstParty, brandExists);
    if (next) { state.setFirstPartyBrands(next); state.setNewFirstParty(''); }
  };
  const addCompetitorBrand = () => {
    const next = withValue(form.competitorBrands, inputs.newCompetitor, brandExists);
    if (next) { state.setCompetitorBrands(next); state.setNewCompetitor(''); }
  };
  const addEntityType = () => {
    const next = withValue(form.customEntityTypes, inputs.newEntityType, includes);
    if (next) { state.setCustomEntityTypes(next); state.setNewEntityType(''); }
  };
  const addFirstPartyDomain = () => {
    const domain = normalizeDomain(inputs.newFirstPartyDomain);
    if (domain && !form.firstPartyDomains.includes(domain)) { state.setFirstPartyDomains([...form.firstPartyDomains, domain]); state.setNewFirstPartyDomain(''); }
  };

  const startSuggestion = (type: BrandType) => {
    state.setExpandingBrand(type); state.setExpansionTarget(type); state.setExpansionAllResult(null); state.setCompetitorDiscoveryResult(null);
  };

  const expandAll = async (type: BrandType) => {
    const brands = type === 'first_party' ? form.firstPartyBrands : form.competitorBrands;
    if (!onExpandAllBrands || brands.length === 0) return;
    startSuggestion(type);
    try { state.setExpansionAllResult(await onExpandAllBrands(brands, type)); state.setPendingExpansionBrands([]); }
    catch (err) { console.error('Error expanding brands:', err); }
    finally { state.setExpandingBrand(null); }
  };

  const findCompetitors = async () => {
    if (!onFindCompetitors || form.firstPartyBrands.length === 0) return;
    startSuggestion('competitor');
    try {
      const discovery = await onFindCompetitors(form.firstPartyBrands, form.competitorBrands);
      state.setCompetitorDiscoveryResult(discovery);
      state.setSuggestedCompetitorDomains(mergeSuggestedDomains(expansion.suggestedCompetitorDomains, discovery.suggested_domains));
      state.setPendingExpansionBrands([]);
    }
    catch (err) { console.error('Error finding competitors:', err); }
    finally { state.setExpandingBrand(null); }
  };

  const cancelSuggestions = () => {
    state.setExpansionAllResult(null); state.setCompetitorDiscoveryResult(null); state.setPendingExpansionBrands([]); state.setExpansionTarget(null);
  };

  const acceptSuggestions = (type: BrandType) => {
    const pending = expansion.pendingExpansionBrands;
    if (type === 'first_party') state.setFirstPartyBrands([...form.firstPartyBrands, ...pending.filter(b => !brandExists(b, form.firstPartyBrands))]);
    else state.setCompetitorBrands([...form.competitorBrands, ...pending.filter(b => !brandExists(b, form.competitorBrands))]);
    cancelSuggestions();
  };

  const togglePending = (brand: string) => {
    const pending = expansion.pendingExpansionBrands;
    state.setPendingExpansionBrands(pending.includes(brand) ? pending.filter(b => b !== brand) : [...pending, brand]);
  };

  const save = async () => {
    state.setSaving(true);
    state.setSaved(false);
    setSaveFailed(false);
    try {
      const saved = state.buildConfig();
      await onSave(saved);
      state.markSaved(saved);
      state.setSaved(true);
      setTimeout(() => state.setSaved(false), 3000);
      onSaveComplete?.();
    } catch (error) {
      console.error('Failed to save config:', error);
      setSaveFailed(true);
    }
    finally { state.setSaving(false); }
  };

  return {
    state,
    addFirstPartyBrand,
    addCompetitorBrand,
    addEntityType,
    addFirstPartyDomain,
    expandAll,
    findCompetitors,
    acceptSuggestions,
    cancelSuggestions,
    togglePending,
    save,
    saveFailed,
  };
}
