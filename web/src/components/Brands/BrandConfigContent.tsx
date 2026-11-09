import { useIsAdmin } from '../../hooks/useIsAdmin';
import { IndustrySelector } from './IndustrySelector';
import { FirstPartyBrandsSection } from './FirstPartyBrandsSection';
import { CompetitorBrandsSection } from './CompetitorBrandsSection';
import { AdvancedSettings } from './AdvancedSettings';
import {
  BrandConfigIntro, advancedSettingsProps
} from './BrandConfigIntro';
import { SaveBar } from './SaveBar';
import { BrandConfigSkeleton } from './BrandConfigSkeleton';
import {
  useBrandConfigEditor, type BrandConfigEditorOptions
} from './useBrandConfigEditor';

interface BrandConfigContentProps extends BrandConfigEditorOptions {readonly loading: boolean;}

/**
 * The Brand Tracking form, shown in Settings › Brand tracking and in the
 * Configure Brands dialog on Brand Mentions: the industry, "Your brand",
 * "Competitors", a collapsed "Advanced" part, and a save bar that appears
 * once something changed.
 */
export const BrandConfigContent = ({
  loading, ...options
}: BrandConfigContentProps) => {
  // Read locally rather than as a prop: this component has two mount points
  // (SettingsView's Brand Tracking tab and BrandConfigPanel under BrandsView),
  // so a prop would have to be threaded from both to close the gap.
  const { isAdmin } = useIsAdmin();
  const editor = useBrandConfigEditor(options);
  const {
    form, inputs, expansion, ui, currentPreset, brandExists,
  } = editor.state;

  if (loading) return <BrandConfigSkeleton />;

  // Saving and the three Bedrock-backed suggestion routes are Admin-only
  // server-side. Read access stays open, so a non-admin sees the configured
  // brands and domains as values but cannot submit changes.
  const canEdit = isAdmin;
  const target = expansion.expansionTarget;

  return (
    <div>
      <BrandConfigIntro canEdit={canEdit} industry={<IndustrySelector industry={form.industry} presets={options.presets} industryPrompts={form.industryPrompts} currentPreset={currentPreset} onIndustryChange={editor.state.setIndustry} />} />

      {/* The fieldset natively disables every nested input and button for
          non-admins: the controls edit form state only Save could persist. */}
      <fieldset disabled={!canEdit} className="space-y-6">
        <FirstPartyBrandsSection
          brands={form.firstPartyBrands}
          newBrand={inputs.newFirstParty}
          domains={form.firstPartyDomains}
          newDomain={inputs.newFirstPartyDomain}
          expanding={expansion.expandingBrand === 'first_party'}
          expansionResult={target === 'first_party' ? expansion.expansionAllResult : null}
          pendingBrands={expansion.pendingExpansionBrands}
          canExpand={!!options.onExpandAllBrands && canEdit}
          onNewBrandChange={editor.state.setNewFirstParty}
          onAddBrand={editor.addFirstPartyBrand}
          onRemoveBrand={(b) => editor.state.setFirstPartyBrands(form.firstPartyBrands.filter(x => x !== b))}
          onNewDomainChange={editor.state.setNewFirstPartyDomain}
          onAddDomain={editor.addFirstPartyDomain}
          onRemoveDomain={(d) => editor.state.setFirstPartyDomains(form.firstPartyDomains.filter(x => x !== d))}
          onExpandAll={() => { void editor.expandAll('first_party'); }}
          onTogglePending={editor.togglePending}
          onAcceptExpansion={() => editor.acceptSuggestions('first_party')}
          onCancelExpansion={editor.cancelSuggestions}
        />
        <CompetitorBrandsSection
          brands={form.competitorBrands}
          newBrand={inputs.newCompetitor}
          domains={form.competitorDomains}
          suggestedDomains={expansion.suggestedCompetitorDomains}
          busy={expansion.expandingBrand === 'competitor'}
          expansionResult={target === 'competitor' ? expansion.expansionAllResult : null}
          discoveryResult={target === 'competitor' ? expansion.competitorDiscoveryResult : null}
          pendingBrands={expansion.pendingExpansionBrands}
          hasFirstPartyBrands={form.firstPartyBrands.length > 0}
          canExpand={!!options.onExpandAllBrands && canEdit}
          canFindCompetitors={!!options.onFindCompetitors && canEdit}
          brandExists={brandExists}
          onNewBrandChange={editor.state.setNewCompetitor}
          onAddBrand={editor.addCompetitorBrand}
          onRemoveBrand={(b) => editor.state.setCompetitorBrands(form.competitorBrands.filter(x => x !== b))}
          onDomainsChange={editor.state.setCompetitorDomains}
          onExpandAll={() => { void editor.expandAll('competitor'); }}
          onFindCompetitors={() => { void editor.findCompetitors(); }}
          onTogglePending={editor.togglePending}
          onAcceptExpansion={() => editor.acceptSuggestions('competitor')}
          onCancelExpansion={editor.cancelSuggestions}
        />
        <AdvancedSettings {...advancedSettingsProps(editor)} />
      </fieldset>

      {canEdit && (
        <SaveBar dirty={ui.dirty} saving={ui.saving} saved={ui.saved} failed={editor.saveFailed} onSave={() => { void editor.save(); }} onDiscard={editor.state.discardChanges} />
      )}
    </div>
  );
};
