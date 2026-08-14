import { useState } from 'react';
import { useOnboardingStatus } from '../../hooks/useOnboardingStatus';
import type { OnboardingSetupStatus } from '../../hooks/useOnboardingStatus';
import { CheckIcon } from '../ui';
import type { SettingsTab } from '../Settings';
import type { TabType } from '../../types';

export const ONBOARDING_DISMISSED_STORAGE_KEY = 'onboarding-dismissed';

function isOnboardingDismissed(): boolean {
  if (typeof window !== 'undefined') {
    return localStorage.getItem(ONBOARDING_DISMISSED_STORAGE_KEY) === 'true';
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

interface OnboardingChecklistProps {
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
        <p className={`text-sm font-medium ${step.complete ? 'text-gray-400 line-through' : 'text-gray-900'}`}>
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
 * First-run setup guide shown on the dashboard. Walks a new installation
 * through the required configuration (API keys, keywords, brand tracking,
 * first run) plus optional scheduling. Hidden once every required step is
 * complete, or when the user dismisses it.
 */
export const OnboardingChecklist = ({
  keywordsCount, hasRunAnalysis, setActiveTab, onNavigateToSettings 
}: OnboardingChecklistProps) => {
  const [dismissed, setDismissed] = useState(isOnboardingDismissed);
  const {
    status, loading 
  } = useOnboardingStatus(!dismissed);

  if (dismissed || loading || !status) {
    return null;
  }

  const steps = buildSteps(status, keywordsCount, hasRunAnalysis, setActiveTab, onNavigateToSettings);
  const requiredSteps = steps.filter((step) => !step.optional);
  const completedRequired = requiredSteps.filter((step) => step.complete).length;

  if (completedRequired === requiredSteps.length) {
    return null;
  }

  const handleDismiss = () => {
    localStorage.setItem(ONBOARDING_DISMISSED_STORAGE_KEY, 'true');
    setDismissed(true);
  };

  return (
    <section
      aria-label="Getting started checklist"
      className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6 mb-6 sm:mb-8"
    >
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-gray-900">Get started with Citation Analysis</h2>
          <p className="text-sm text-gray-500 mt-1">
            Complete these steps to start tracking how AI models cite your brand.
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded-full text-xs">
            {completedRequired} of {requiredSteps.length} required steps done
          </span>
          <button
            onClick={handleDismiss}
            className="text-xs text-gray-500 hover:text-gray-700 underline whitespace-nowrap"
          >
            Set up later
          </button>
        </div>
      </div>
      <ol className="mt-4 divide-y divide-gray-100">
        {steps.map((step, index) => (
          <StepRow key={step.id} step={step} stepNumber={index + 1} />
        ))}
      </ol>
    </section>
  );
};
