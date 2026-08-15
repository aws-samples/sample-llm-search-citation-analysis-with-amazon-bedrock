import {
  useState, useEffect 
} from 'react';
import { useOnboardingStatus } from '../../hooks/useOnboardingStatus';
import type { OnboardingSetupStatus } from '../../hooks/useOnboardingStatus';
import { Modal } from '../ui/Modal';
import { CheckIcon } from '../ui';
import type { SettingsTab } from '../Settings';
import type { TabType } from '../../types';

/** Set when the user explicitly skips onboarding ("Set up later"). */
export const ONBOARDING_DISMISSED_STORAGE_KEY = 'onboarding-dismissed';
/**
 * Set once every required step has been observed complete. From then on the
 * status endpoints are never queried again, so configured installations pay
 * no onboarding overhead.
 */
export const ONBOARDING_COMPLETE_STORAGE_KEY = 'onboarding-complete';

function readStorageFlag(key: string): boolean {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(key) === 'true';
  }
  return false;
}

interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  actionLabel: string;
  complete: boolean;
  optional: boolean;
  onAction: () => void;
}

interface OnboardingModalProps {
  readonly keywordsCount: number;
  readonly hasRunAnalysis: boolean;
  readonly setActiveTab: (tab: TabType) => void;
  readonly onNavigateToSettings: (tab: SettingsTab) => void;
}

function buildSteps(
  status: OnboardingSetupStatus,
  keywordsCount: number,
  hasRunAnalysis: boolean,
  setActiveTab: (tab: TabType) => void,
  onNavigateToSettings: (tab: SettingsTab) => void
): OnboardingStep[] {
  return [
    {
      id: 'providers',
      title: 'Add AI provider API keys',
      description: 'Connect at least one provider (OpenAI, Perplexity, Gemini, or Claude) so analysis runs can query it.',
      actionLabel: 'Configure providers',
      complete: status.providersConfigured,
      optional: false,
      onAction: () => onNavigateToSettings('providers'),
    },
    {
      id: 'keywords',
      title: 'Add keywords to track',
      description: 'Keywords are the search queries sent to each AI provider.',
      actionLabel: 'Add keywords',
      complete: keywordsCount > 0,
      optional: false,
      onAction: () => onNavigateToSettings('keywords'),
    },
    {
      id: 'brand',
      title: 'Set up brand tracking',
      description: 'Add your brand and competitor brands so mentions are attributed correctly.',
      actionLabel: 'Configure brands',
      complete: status.brandConfigured,
      optional: false,
      onAction: () => onNavigateToSettings('brand-config'),
    },
    {
      id: 'first-run',
      title: 'Run your first analysis',
      description: 'Trigger a run to populate the dashboard with citations and brand mentions.',
      actionLabel: 'Run analysis',
      complete: hasRunAnalysis,
      optional: false,
      onAction: () => setActiveTab('execution'),
    },
    {
      id: 'schedule',
      title: 'Automate runs with a schedule',
      description: 'Keep results fresh by running the analysis automatically.',
      actionLabel: 'Create schedule',
      complete: status.scheduleConfigured,
      optional: true,
      onAction: () => setActiveTab('schedule'),
    },
    {
      id: 'personas',
      title: 'Define user personas',
      description: 'See how AI responses change based on who is asking, e.g. a family traveler vs a business executive.',
      actionLabel: 'Add personas',
      complete: status.personasConfigured,
      optional: true,
      onAction: () => onNavigateToSettings('query-prompts'),
    },
  ];
}

interface StepRowProps {
  readonly step: OnboardingStep;
  readonly stepNumber: number;
}

const StepRow = ({
  step, stepNumber 
}: StepRowProps) => (
  <li className="flex items-start gap-3 py-3">
    {step.complete ? (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-emerald-700">
        <CheckIcon className="w-3.5 h-3.5" />
      </span>
    ) : (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
        {stepNumber}
      </span>
    )}
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className={`text-sm font-medium ${step.complete ? 'text-gray-400 line-through' : 'text-gray-900 dark:text-white'}`}>
          {step.title}
        </p>
        {step.optional && (
          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">Optional</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
    </div>
    {!step.complete && (
      <button
        onClick={step.onAction}
        className="px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 transition-colors whitespace-nowrap"
      >
        {step.actionLabel}
      </button>
    )}
  </li>
);

/**
 * First-run setup guide shown as a modal so new installations cannot miss it.
 * Walks through the required configuration (API keys, keywords, brand
 * tracking, first run) plus optional scheduling and personas.
 *
 * Lifecycle:
 * - Only queries setup status while onboarding is neither skipped nor
 *   complete; once every required step has been seen complete, a persisted
 *   flag stops all future checks.
 * - "Set up later" skips permanently (persisted).
 * - Escape / backdrop / a step action close the modal for the current
 *   session only, so it reappears on the next visit while setup is pending.
 */
export const OnboardingModal = ({
  keywordsCount, hasRunAnalysis, setActiveTab, onNavigateToSettings 
}: OnboardingModalProps) => {
  const [dismissed, setDismissed] = useState(() => readStorageFlag(ONBOARDING_DISMISSED_STORAGE_KEY));
  const [completed, setCompleted] = useState(() => readStorageFlag(ONBOARDING_COMPLETE_STORAGE_KEY));
  const [sessionClosed, setSessionClosed] = useState(false);

  const enabled = !dismissed && !completed;
  const {
    status, loading 
  } = useOnboardingStatus(enabled);

  const steps = status === null
    ? []
    : buildSteps(status, keywordsCount, hasRunAnalysis, setActiveTab, onNavigateToSettings);
  const requiredSteps = steps.filter((step) => !step.optional);
  const completedRequired = requiredSteps.filter((step) => step.complete).length;
  const allRequiredComplete = requiredSteps.length > 0 && completedRequired === requiredSteps.length;

  // Persist completion so future sessions skip the status checks entirely.
  useEffect(() => {
    if (enabled && allRequiredComplete) {
      localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, 'true');
      setCompleted(true);
    }
  }, [enabled, allRequiredComplete]);

  const isOpen = enabled && !sessionClosed && !loading && status !== null && !allRequiredComplete;

  if (!isOpen) {
    return null;
  }

  const handleSkip = () => {
    localStorage.setItem(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
    setDismissed(true);
  };

  const handleSessionClose = () => {
    setSessionClosed(true);
  };

  const handleStepAction = (step: OnboardingStep) => {
    setSessionClosed(true);
    step.onAction();
  };

  return (
    <Modal
      isOpen
      onClose={handleSessionClose}
      title="Get started with Citation Analysis"
      size="xl"
    >
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-gray-500">
          Complete these steps to start tracking how AI models cite your brand.
        </p>
        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs whitespace-nowrap">
          {completedRequired} of {requiredSteps.length} required steps done
        </span>
      </div>
      <ol className="mt-2 divide-y divide-gray-100">
        {steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={{
              ...step,
              onAction: () => handleStepAction(step),
            }}
            stepNumber={index + 1}
          />
        ))}
      </ol>
      <div className="mt-4 pt-4 border-t border-gray-100 flex justify-end">
        <button
          onClick={handleSkip}
          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
        >
          Set up later
        </button>
      </div>
    </Modal>
  );
};
