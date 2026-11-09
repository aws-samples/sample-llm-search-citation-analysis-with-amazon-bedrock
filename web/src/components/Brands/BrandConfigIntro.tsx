import type {
  ComponentProps, ReactNode
} from 'react';
import type { AdvancedSettings } from './AdvancedSettings';
import type { useBrandConfigEditor } from './useBrandConfigEditor';

interface BrandConfigIntroProps {
  readonly canEdit: boolean;
  /** The industry picker, shown on the right. */
  readonly industry: ReactNode;
}

/** The top of the Brand Tracking form: what the page is for, the read-only note for non-admins, and the industry. */
export function BrandConfigIntro({
  canEdit, industry
}: BrandConfigIntroProps) {
  return (
    <div className="flex flex-col gap-4 pb-6 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 max-w-2xl">
        <p className="text-base text-gray-900">Tell the dashboard who you are and who you compete with.</p>
        <p className="mt-1 text-sm text-gray-600">Every AI answer is scanned for these names and websites to count your mentions, share of voice and citations.</p>
        {!canEdit && (
          <p className="mt-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            Brand tracking is read-only. Contact an administrator to make changes.
          </p>
        )}
      </div>
      <fieldset disabled={!canEdit} className="contents">{industry}</fieldset>
    </div>
  );
}

/** The Advanced part's props from the form: extraction options, the Custom industry's entity types, the prompt. */
export function advancedSettingsProps(editor: ReturnType<typeof useBrandConfigEditor>): ComponentProps<typeof AdvancedSettings> {
  const {
    form, inputs, currentPreset
  } = editor.state;
  return {
    options: {
      includeSentiment: form.includeSentiment,
      includeRankingContext: form.includeRankingContext,
      maxBrands: form.maxBrands,
      onSentimentChange: editor.state.setIncludeSentiment,
      onRankingContextChange: editor.state.setIncludeRankingContext,
      onMaxBrandsChange: editor.state.setMaxBrands,
    },
    entityTypes: form.industry === 'custom' ? {
      types: form.customEntityTypes,
      draft: inputs.newEntityType,
      onDraftChange: editor.state.setNewEntityType,
      onAdd: editor.addEntityType,
      onRemove: (type) => editor.state.setCustomEntityTypes(form.customEntityTypes.filter((t) => t !== type)),
    } : null,
    prompt: {
      industryName: currentPreset?.name ?? form.industry,
      hasCustomPrompt: form.industry in form.industryPrompts,
      currentPrompt: form.currentPrompt,
      promptModified: form.promptModified,
      onPromptChange: editor.state.handlePromptChange,
      onResetToDefault: editor.state.resetPromptToDefault,
    },
  };
}
