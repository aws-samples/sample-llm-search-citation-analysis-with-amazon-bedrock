import {
  useId, useState
} from 'react';
import type {
  BedrockModelOption, BedrockTierId
} from '../../api/bedrockModels';
import type { BedrockTierEditor } from '../../hooks/useBedrockModels';
import { Button } from '../ui/Button';
import { ConfirmModal } from '../ui/Modal';
import {
  BedrockCurrentModel, BedrockSaveFeedback, BedrockTestOutput
} from './BedrockModelsStatus';
import {
  describeTierUse, modelName, TIER_LABELS
} from './bedrockModelsText';

export interface BedrockModelsTierCardProps {
  readonly editor: BedrockTierEditor;
  readonly models: readonly BedrockModelOption[];
  readonly onSelectModel: (tier: BedrockTierId, model: string) => void;
  readonly onTest: (tier: BedrockTierId) => void;
  readonly onSave: (tier: BedrockTierId) => Promise<void>;
  readonly onRestoreDefault: (tier: BedrockTierId) => Promise<void>;
}

/** The listed models, plus the picked one when the account no longer lists it (so the dropdown can show it). */
function pickerOptions(models: readonly BedrockModelOption[], picked: string): readonly BedrockModelOption[] {
  return models.some((model) => model.id === picked) ? models : [{
    id: picked,
    name: picked,
  }, ...models];
}

/** One processing tier: what it does, the model it runs on, and the pick → test → save controls. */
export const BedrockModelsTierCard = ({
  editor, models, onSelectModel, onTest, onSave, onRestoreDefault
}: BedrockModelsTierCardProps) => {
  const headingId = useId();
  const selectId = useId();
  const [confirmingDefault, setConfirmingDefault] = useState(false);
  const {
    tier, draft, test, save, canSave
  } = editor;
  const label = TIER_LABELS[tier.tier];
  const saving = save.status === 'saving';

  return (
    <article aria-labelledby={headingId} className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
      <h4 id={headingId} className="text-lg font-semibold text-gray-900">{label}</h4>
      <p className="mt-1 text-sm text-gray-600">{describeTierUse(tier.roles)}</p>
      <BedrockCurrentModel tier={tier} models={models} />

      <label htmlFor={selectId} className="mt-4 mb-1 block text-sm font-medium text-gray-700">{`Model for ${label}`}</label>
      <div className="flex flex-wrap items-center gap-2">
        <select
          id={selectId}
          value={draft}
          onChange={(event) => onSelectModel(tier.tier, event.target.value)}
          disabled={saving}
          className="min-w-[12rem] flex-1 p-2 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-gray-900"
        >
          {pickerOptions(models, draft).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
        <Button variant="secondary" onClick={() => onTest(tier.tier)} disabled={saving || test.status === 'testing'}>
          {test.status === 'testing' ? 'Testing…' : 'Test'}
        </Button>
        <Button onClick={() => { void onSave(tier.tier); }} disabled={!canSave}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {!tier.is_default && (
          <Button variant="ghost" onClick={() => setConfirmingDefault(true)} disabled={saving}>
            Use default
          </Button>
        )}
      </div>

      <BedrockTestOutput test={test} />
      <BedrockSaveFeedback save={save} />

      <ConfirmModal
        isOpen={confirmingDefault}
        onClose={() => setConfirmingDefault(false)}
        onConfirm={() => { void onRestoreDefault(tier.tier); }}
        title={`Use the default model for ${label}?`}
        message={`${label} goes back to ${modelName(models, tier.default_model)}. The default needs no test.`}
        confirmText="Use default"
      />
    </article>
  );
};
