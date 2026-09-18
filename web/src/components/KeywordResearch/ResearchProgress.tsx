import type {
  KeywordResearchItem, ResearchStep
} from '../../types';
import {
  formatResearchFailureMessage,
  getResearchStatusClass,
  getResearchStatusLabel,
  getResearchStepStatusClass,
  getResearchStepStatusLabel,
  isActiveResearchStatus,
  isRetryableResearchStatus,
  resolveResearchStatus,
} from '../../formatting/researchStatus';
import { Spinner } from '../ui/Spinner';

interface ResearchProgressProps {
  job: KeywordResearchItem;
  /** Re-run the failed steps; absent when the caller cannot retry. */
  onRetry?: (job: KeywordResearchItem) => void;
  retrying?: boolean;
}

const PROVIDER_LABELS: Record<string, string> = {
  perplexity: 'Perplexity',
  openai: 'OpenAI',
  gemini: 'Gemini',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * Live view of one research job: overall status, how many provider steps
 * have finished, and each step's outcome. A `partial` or `failed` job offers
 * a retry that re-runs only the steps that did not complete, keeping the
 * results already gathered.
 */
export const ResearchProgress = ({
  job, onRetry, retrying = false
}: ResearchProgressProps) => {
  const status = resolveResearchStatus(job.status);
  if (status === null) return null;

  const steps = job.steps ?? [];
  const total = job.steps_total ?? steps.length;
  const done = job.steps_done ?? steps.filter((step) => step.status === 'completed' || step.status === 'failed').length;
  const active = isActiveResearchStatus(status);
  const canRetry = onRetry !== undefined && isRetryableResearchStatus(status) && !retrying;

  return (
    <section
      aria-live="polite"
      aria-label="Research progress"
      className="bg-white rounded-lg border border-gray-200 p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          {active && <Spinner size="sm" className="text-gray-400" />}
          <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getResearchStatusClass(status)}`}>
            {getResearchStatusLabel(status)}
          </span>
          <span className="text-sm text-gray-700">
            {total > 0 ? `${done} of ${total} providers finished` : 'Planning providers…'}
          </span>
          {job.keyword_count > 0 && (
            <span className="text-sm text-gray-500">· {job.keyword_count} keywords so far</span>
          )}
        </div>
        {canRetry && (
          <button
            type="button"
            onClick={() => onRetry(job)}
            className="px-3 py-1.5 text-sm font-medium text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Retry failed providers
          </button>
        )}
      </div>

      {steps.length > 0 && (
        <ul className="grid grid-cols-1 sm:grid-cols-3 gap-2" aria-label="Provider steps">
          {steps.map((step) => <StepRow key={step.step_id} step={step} />)}
        </ul>
      )}

      {!active && job.error_message !== undefined && job.error_message !== '' && (
        <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1" title={job.error_message}>
          {formatResearchFailureMessage(job.error_message)}
        </p>
      )}
    </section>
  );
};

const StepRow = ({ step }: { step: ResearchStep }) => (
  <li className="flex flex-col gap-0.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium text-gray-900">{providerLabel(step.provider)}</span>
      <span className={`font-medium ${getResearchStepStatusClass(step.status)}`}>
        {getResearchStepStatusLabel(step.status)}
      </span>
    </div>
    {step.status === 'completed' && (
      <span className="text-gray-500">{step.keyword_count} keywords</span>
    )}
    {step.status === 'failed' && step.error_message && (
      <span className="text-red-700 truncate" title={step.error_message}>{step.error_message}</span>
    )}
  </li>
);
