import {
  useBedrockModels, type BedrockModelsController
} from '../../hooks/useBedrockModels';
import { Button } from '../ui/Button';
import { ErrorAlert } from '../ui/ErrorAlert';
import { BedrockModelsSkeleton } from './BedrockModelsSkeleton';
import { BedrockModelsTierCard } from './BedrockModelsTierCard';
import { SettingsSectionHeader } from './SettingsSectionHeader';

const DESCRIPTION = 'Choose the Claude model behind each processing tier. Test a model before saving: '
  + "the test makes one real call and checks your account's quota.";

const BedrockModelsBody = ({ controller }: { readonly controller: BedrockModelsController }) => {
  const { listing } = controller;
  if (listing.status === 'loading') return <BedrockModelsSkeleton />;
  if (listing.status === 'failed') {
    return (
      <div className="space-y-3">
        <ErrorAlert message={listing.message} />
        <Button variant="secondary" onClick={controller.retry}>Retry</Button>
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {controller.editors.map((editor) => (
        <BedrockModelsTierCard
          key={editor.tier.tier}
          editor={editor}
          models={controller.models}
          onSelectModel={controller.selectModel}
          onTest={controller.testModel}
          onSave={controller.saveModel}
          onRestoreDefault={controller.restoreDefault}
        />
      ))}
    </div>
  );
};

/** Settings › Bedrock models (admin only): the Claude model behind each processing tier. */
export function BedrockModelsConfig() {
  const controller = useBedrockModels();
  return (
    <div className="space-y-6">
      <SettingsSectionHeader title="Bedrock models" description={DESCRIPTION}>{null}</SettingsSectionHeader>
      <BedrockModelsBody controller={controller} />
    </div>
  );
}
