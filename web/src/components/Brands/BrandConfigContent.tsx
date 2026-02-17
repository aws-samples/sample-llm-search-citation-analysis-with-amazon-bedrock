import type {
  BrandConfig, IndustryPresets, BrandExpansionAllResult, CompetitorDiscoveryResult 
} from '../../types';
import { useBrandConfigForm } from '../../hooks/useBrandConfigForm';
import { IndustrySelector } from './IndustrySelector';
import { ExtractionOptions } from './ExtractionOptions';
import { DomainList } from './DomainList';
import { PromptEditor } from './PromptEditor';
import { FirstPartyBrandsSection } from './FirstPartyBrandsSection';
import { CompetitorBrandsSection } from './CompetitorBrandsSection';

interface BrandConfigContentProps {
  readonly config: BrandConfig | null;
  readonly presets: IndustryPresets | null;
  readonly loading: boolean;
  readonly onSave: (config: BrandConfig) => Promise<void>;
  readonly onExpandAllBrands?: (brands: string[], type: 'first_party' | 'competitor') => Promise<BrandExpansionAllResult>;
  readonly onFindCompetitors?: (firstPartyBrands: string[], existingCompetitors: string[]) => Promise<CompetitorDiscoveryResult>;
  readonly onSaveComplete?: () => void;
}

export const BrandConfigContent = ({
  config, presets, loading, onSave, onExpandAllBrands, onFindCompetitors, onSaveComplete 
}: BrandConfigContentProps) => {
  const {
    form, inputs, expansion, ui,
    setIndustry, setFirstPartyBrands, setFirstPartyDomains, setCompetitorBrands, setCustomEntityTypes,
    setIncludeSentiment, setIncludeRankingContext, setMaxBrands,
    setNewFirstParty, setNewFirstPartyDomain, setNewCompetitor, setNewEntityType,
    setActiveTab, setSaving, setSaved,
    setSelectedFirstPartyBrand, setSelectedCompetitorBrand, setExpandingBrand,
    setExpansionAllResult, setCompetitorDiscoveryResult, setPendingExpansionBrands, setExpansionTarget,
    handlePromptChange, resetPromptToDefault, buildConfig, brandExists, currentPreset,
  } = useBrandConfigForm(config, presets);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await onSave(buildConfig());
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
      onSaveComplete?.();
    } catch (error) { console.error('Failed to save config:', error); }
    finally { setSaving(false); }
  };

  const addFirstPartyBrand = () => { if (inputs.newFirstParty.trim() && !brandExists(inputs.newFirstParty.trim(), form.firstPartyBrands)) { setFirstPartyBrands([...form.firstPartyBrands, inputs.newFirstParty.trim()]); setNewFirstParty(''); } };
  const addCompetitorBrand = () => { if (inputs.newCompetitor.trim() && !brandExists(inputs.newCompetitor.trim(), form.competitorBrands)) { setCompetitorBrands([...form.competitorBrands, inputs.newCompetitor.trim()]); setNewCompetitor(''); } };
  const addEntityType = () => { if (inputs.newEntityType.trim() && !form.customEntityTypes.includes(inputs.newEntityType.trim())) { setCustomEntityTypes([...form.customEntityTypes, inputs.newEntityType.trim()]); setNewEntityType(''); } };

  const addFirstPartyDomain = () => {
    const trimmed = inputs.newFirstPartyDomain.trim().toLowerCase();
    const domain = trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '').split('/')[0];
    if (domain && !form.firstPartyDomains.includes(domain)) { setFirstPartyDomains([...form.firstPartyDomains, domain]); setNewFirstPartyDomain(''); }
  };

  const handleExpandAllFirstPartyBrands = async () => {
    if (!onExpandAllBrands || form.firstPartyBrands.length === 0) return;
    setExpandingBrand('first_party'); setExpansionTarget('first_party'); setExpansionAllResult(null); setCompetitorDiscoveryResult(null);
    try { setExpansionAllResult(await onExpandAllBrands(form.firstPartyBrands, 'first_party')); setPendingExpansionBrands([]); }
    catch (err) { console.error('Error expanding all brands:', err); }
    finally { setExpandingBrand(null); }
  };

  const handleExpandAllCompetitorBrands = async () => {
    if (!onExpandAllBrands || form.competitorBrands.length === 0) return;
    setExpandingBrand('competitor'); setExpansionTarget('competitor'); setExpansionAllResult(null); setCompetitorDiscoveryResult(null);
    try { setExpansionAllResult(await onExpandAllBrands(form.competitorBrands, 'competitor')); setPendingExpansionBrands([]); }
    catch (err) { console.error('Error expanding all competitor brands:', err); }
    finally { setExpandingBrand(null); }
  };

  const handleFindCompetitors = async () => {
    if (!onFindCompetitors || form.firstPartyBrands.length === 0) return;
    setExpandingBrand('competitor'); setExpansionTarget('competitor'); setExpansionAllResult(null); setCompetitorDiscoveryResult(null);
    try { setCompetitorDiscoveryResult(await onFindCompetitors(form.firstPartyBrands, form.competitorBrands)); setPendingExpansionBrands([]); }
    catch (err) { console.error('Error finding competitors:', err); }
    finally { setExpandingBrand(null); }
  };

  const acceptExpansionSuggestions = (type: 'first_party' | 'competitor') => {
    if (type === 'first_party') setFirstPartyBrands([...form.firstPartyBrands, ...expansion.pendingExpansionBrands.filter(b => !brandExists(b, form.firstPartyBrands))]);
    else setCompetitorBrands([...form.competitorBrands, ...expansion.pendingExpansionBrands.filter(b => !brandExists(b, form.competitorBrands))]);
    cancelExpansion();
  };

  const cancelExpansion = () => { setExpansionAllResult(null); setCompetitorDiscoveryResult(null); setPendingExpansionBrands([]); setExpansionTarget(null); setSelectedFirstPartyBrand(null); setSelectedCompetitorBrand(null); };
  const togglePendingBrand = (brand: string) => setPendingExpansionBrands(expansion.pendingExpansionBrands.includes(brand) ? expansion.pendingExpansionBrands.filter(b => b !== brand) : [...expansion.pendingExpansionBrands, brand]);

  if (loading) return <div className="text-center py-12 text-gray-500">Loading configuration...</div>;

  return (
    <div className="space-y-6">
      <div className="flex gap-2 border-b border-gray-200 pb-3">
        <button onClick={() => setActiveTab('settings')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${ui.activeTab === 'settings' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>Settings & Brands</button>
        <button onClick={() => setActiveTab('prompt')} className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-2 ${ui.activeTab === 'prompt' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
          Extraction Prompt
          {Object.keys(form.industryPrompts).length > 0 && <span className="px-2 py-0.5 bg-gray-700 text-white rounded-full text-xs">{Object.keys(form.industryPrompts).length}</span>}
        </button>
      </div>

      {ui.activeTab === 'settings' ? (
        <div className="space-y-6">
          <IndustrySelector industry={form.industry} presets={presets} industryPrompts={form.industryPrompts} currentPreset={currentPreset} onIndustryChange={setIndustry} />
          <FirstPartyBrandsSection brands={form.firstPartyBrands} newBrand={inputs.newFirstParty} selectedBrand={expansion.selectedFirstPartyBrand} expandingBrand={expansion.expandingBrand} expansionResult={expansion.expansionAllResult} expansionTarget={expansion.expansionTarget} pendingBrands={expansion.pendingExpansionBrands} canExpand={!!onExpandAllBrands} onNewBrandChange={setNewFirstParty} onAddBrand={addFirstPartyBrand} onRemoveBrand={(b) => setFirstPartyBrands(form.firstPartyBrands.filter(x => x !== b))} onSelectBrand={setSelectedFirstPartyBrand} onExpandAll={handleExpandAllFirstPartyBrands} onTogglePending={togglePendingBrand} onAcceptExpansion={() => acceptExpansionSuggestions('first_party')} onCancelExpansion={cancelExpansion} />
          <DomainList domains={form.firstPartyDomains} newDomain={inputs.newFirstPartyDomain} onNewDomainChange={setNewFirstPartyDomain} onAddDomain={addFirstPartyDomain} onRemoveDomain={(d) => setFirstPartyDomains(form.firstPartyDomains.filter(x => x !== d))} />
          <CompetitorBrandsSection brands={form.competitorBrands} newBrand={inputs.newCompetitor} selectedBrand={expansion.selectedCompetitorBrand} expandingBrand={expansion.expandingBrand} expansionResult={expansion.expansionAllResult} discoveryResult={expansion.competitorDiscoveryResult} expansionTarget={expansion.expansionTarget} pendingBrands={expansion.pendingExpansionBrands} hasFirstPartyBrands={form.firstPartyBrands.length > 0} canExpand={!!onExpandAllBrands} canFindCompetitors={!!onFindCompetitors} brandExists={brandExists} onNewBrandChange={setNewCompetitor} onAddBrand={addCompetitorBrand} onRemoveBrand={(b) => setCompetitorBrands(form.competitorBrands.filter(x => x !== b))} onSelectBrand={setSelectedCompetitorBrand} onExpandAll={handleExpandAllCompetitorBrands} onFindCompetitors={handleFindCompetitors} onTogglePending={togglePendingBrand} onAcceptExpansion={() => acceptExpansionSuggestions('competitor')} onCancelExpansion={cancelExpansion} />
          {form.industry === 'custom' && (
            <div className="bg-violet-50 rounded-lg p-4 border border-violet-200">
              <h3 className="text-sm font-semibold text-violet-800 mb-2">Custom Entity Types</h3>
              <div className="flex gap-2 mb-3">
                <input type="text" value={inputs.newEntityType} onChange={(e) => setNewEntityType(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addEntityType()} placeholder="Enter entity type..." className="flex-1 p-2 border border-violet-300 rounded-lg focus:ring-2 focus:ring-violet-500 bg-white text-sm" />
                <button onClick={addEntityType} className="px-4 py-2 bg-violet-600 text-white rounded-lg hover:bg-violet-700 transition-colors text-sm">Add</button>
              </div>
              <div className="flex flex-wrap gap-2">
                {form.customEntityTypes.map((type) => (
                  <span key={type} className="px-3 py-1 bg-violet-100 text-violet-800 rounded-full text-sm flex items-center gap-2">{type}<button onClick={() => setCustomEntityTypes(form.customEntityTypes.filter((t) => t !== type))} className="text-violet-600 hover:text-violet-800 font-bold">×</button></span>
                ))}
              </div>
            </div>
          )}
          <ExtractionOptions includeSentiment={form.includeSentiment} includeRankingContext={form.includeRankingContext} maxBrands={form.maxBrands} onSentimentChange={setIncludeSentiment} onRankingContextChange={setIncludeRankingContext} onMaxBrandsChange={setMaxBrands} />
        </div>
      ) : (
        <PromptEditor industry={form.industry} presets={presets} industryPrompts={form.industryPrompts} currentPrompt={form.currentPrompt} promptModified={form.promptModified} onIndustryChange={setIndustry} onPromptChange={handlePromptChange} onResetToDefault={resetPromptToDefault} />
      )}

      <div className="flex justify-end gap-3 pt-4 border-t border-gray-200">
        {ui.saved && <span className="text-green-600 text-sm flex items-center gap-1"><svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>Saved!</span>}
        <button onClick={handleSave} disabled={ui.saving} className="px-6 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors disabled:opacity-50 text-sm font-medium">{ui.saving ? 'Saving...' : 'Save Configuration'}</button>
      </div>
    </div>
  );
};

export default BrandConfigContent;
