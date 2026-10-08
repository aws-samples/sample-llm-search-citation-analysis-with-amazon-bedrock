import type {
  BedrockModelOption, BedrockTier
} from '../../api/bedrockModels';
import type {
  BedrockSaveState, BedrockTestState
} from '../../hooks/useBedrockModels';
import { formatDateOnly } from '../../formatting/dateFormatter';
import { ErrorAlert } from '../ui/ErrorAlert';
import {
  describeTestResult, modelName, REQUEST_STYLE_LABELS
} from './bedrockModelsText';

const BADGE_CLASS = 'rounded-full px-2 py-0.5 text-xs font-medium';

function changeLabel(tier: BedrockTier): string {
  if (tier.is_default) return 'Default';
  return tier.model_updated_at === null ? 'Changed' : `Changed ${formatDateOnly(tier.model_updated_at)}`;
}

/** The model the tier runs on now, whether it is the default, and how the app talks to it. */
export const BedrockCurrentModel = ({
  tier, models
}: {
  readonly tier: BedrockTier;
  readonly models: readonly BedrockModelOption[] 
}) => (
  <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-gray-600">
    <span>
      {'Current model: '}
      <span className="font-medium text-gray-900">{modelName(models, tier.model)}</span>
    </span>
    <span className={`${BADGE_CLASS} bg-gray-100 text-gray-700`}>{changeLabel(tier)}</span>
    {tier.request_style !== null && (
      <span className={`${BADGE_CLASS} bg-blue-50 text-blue-700`}>{REQUEST_STYLE_LABELS[tier.request_style]}</span>
    )}
  </div>
);

function testText(test: BedrockTestState): string {
  if (test.status === 'testing') return 'Testing…';
  return test.status === 'done' ? describeTestResult(test.result) : '';
}

function testTone(test: BedrockTestState): string {
  if (test.status !== 'done') return 'text-gray-500';
  return test.result.valid ? 'text-green-700' : 'text-red-700';
}

/** The latest test of the picked model, announced as it changes. */
export const BedrockTestOutput = ({ test }: { readonly test: BedrockTestState }) => (
  <output aria-live="polite" className={`mt-3 block text-sm ${testTone(test)}`}>{testText(test)}</output>
);

/** "Saved" after a save, or why the server refused it. */
export const BedrockSaveFeedback = ({ save }: { readonly save: BedrockSaveState }) => {
  if (save.status === 'failed') return <ErrorAlert message={save.message} spacingClassName="mt-3 " />;
  if (save.status !== 'saved') return null;
  return <output className="mt-3 block text-sm font-medium text-green-700">Saved</output>;
};
