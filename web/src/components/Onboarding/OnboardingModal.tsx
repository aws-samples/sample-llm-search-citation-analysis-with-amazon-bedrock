import {
  useState, useEffect 
} from 'react';
import { useOnboardingStatus } from '../../hooks/useOnboardingStatus';
import type { OnboardingSetupStatus } from '../../hooks/useOnboardingStatus';
import { useIsAdmin } from '../../hooks/useIsAdmin';
import { Modal } from '../ui/Modal';
import { CheckIcon } from '../ui';
import { Button } from '../ui/Button';
import type { SettingsTab } from '../Settings';
import type { TabType } from '../../types';

/** Set when the user explicitly skips onboarding ("Don't show again"). */
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
      id: 'providers',
      title: 'Add AI provider API keys',
      description: 'Connect at least one provider (OpenAI, Perplexity, Gemini, or Claude) so analysis runs can query it.',
      actionLabel: 'Configure providers',
      complete: status.providersConfigured,
      optional: false,
      onAction: () => onNavigateToSettings('providers'),
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

/** The step whose button is the primary action: the first required one still to do, else the first optional one. */
function firstStepToDo(steps: readonly OnboardingStep[]): string | undefined {
  const toDo = steps.filter((step) => !step.complete);
  return (toDo.find((step) => !step.optional) ?? toDo[0])?.id;
}

interface StepRowProps {
  readonly step: OnboardingStep;
  readonly stepNumber: number;
  /** The first step still to do: its button is the one primary action of the guide. */
  readonly isNext: boolean;
}

const StepRow = ({
  step, stepNumber, isNext
}: StepRowProps) => (
  <li className="flex items-start gap-3 py-3">
    {step.complete ? (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-emerald-700">
        <CheckIcon className="w-3.5 h-3.5" />
      </span>
    ) : (
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
        {stepNumber}
      </span>
    )}
    <div className="flex-1 min-w-0">
      <div className="flex items-center gap-2">
        <p className={`text-sm font-medium ${step.complete ? 'text-gray-500 line-through' : 'text-gray-900 dark:text-white'}`}>
          {step.title}
        </p>
        {step.optional && (
          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">Optional</span>
        )}
      </div>
      <p className="text-xs text-gray-500 mt-0.5">{step.description}</p>
    </div>
    {!step.complete && (
      <Button size="sm" variant={isNext ? 'primary' : 'secondary'} onClick={step.onAction} className="whitespace-nowrap">
        {step.actionLabel}
      </Button>
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
 * - "Don't show again" skips permanently (persisted).
 * - Escape / backdrop / a step action close the modal for the current
 *   session only, so it reappears on the next visit while setup is pending.
 */
export const OnboardingModal = ({
  keywordsCount, hasRunAnalysis, setActiveTab, onNavigateToSettings 
}: OnboardingModalProps) => {
  const [dismissed, setDismissed] = useState(() => readStorageFlag(ONBOARDING_DISMISSED_STORAGE_KEY));
  const [completed, setCompleted] = useState(() => readStorageFlag(ONBOARDING_COMPLETE_STORAGE_KEY));
  const [sessionClosed, setSessionClosed] = useState(false);

  // Every step in `buildSteps` points at an Admin-only route: providers,
  // brand config, the first run, schedules, personas. A non-admin would get a
  // blocking modal listing six things they cannot do, so it is suppressed
  // wholesale rather than filtered — an empty `requiredSteps` would leave
  // `allRequiredComplete` false and render the modal with no list at all.
  const {
    isAdmin, loading: isAdminLoading 
  } = useIsAdmin();

  const enabled = !dismissed && !completed && isAdmin;
  const {
    status, loading 
  } = useOnboardingStatus(enabled);

  const steps = status === null
    ? []
    : buildSteps(status, keywordsCount, hasRunAnalysis, setActiveTab, onNavigateToSettings);
  const requiredSteps = steps.filter((step) => !step.optional);
  const completedRequired = requiredSteps.filter((step) => step.complete).length;
  const allRequiredComplete = requiredSteps.length > 0 && completedRequired === requiredSteps.length;
  const nextStepId = firstStepToDo(steps);

  // Persist completion so future sessions skip the status checks entirely.
  useEffect(() => {
    if (enabled && allRequiredComplete) {
      localStorage.setItem(ONBOARDING_COMPLETE_STORAGE_KEY, 'true');
      setCompleted(true);
    }
  }, [enabled, allRequiredComplete]);

  const isOpen = enabled && !isAdminLoading && !sessionClosed && !loading
    && status !== null && !allRequiredComplete;

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
          Do the required steps in order. Your first analysis run fills the Dashboard with answers, brand mentions and
          citations.
        </p>
        <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs whitespace-nowrap">
          {completedRequired} of {requiredSteps.length} required steps done
        </span>
      </div>
      <ol className="mt-2 divide-y divide-gray-100 dark:divide-gray-700">
        {steps.map((step, index) => (
          <StepRow
            key={step.id}
            step={{
              ...step,
              onAction: () => handleStepAction(step),
            }}
            stepNumber={index + 1}
            isNext={step.id === nextStepId}
          />
        ))}
      </ol>
      <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3">
        <p className="text-xs text-gray-500">Close this guide to see it again on your next visit.</p>
        <Button variant="ghost" onClick={handleSkip} className="whitespace-nowrap">
          Don&apos;t show again
        </Button>
      </div>
    </Modal>
  );
};
