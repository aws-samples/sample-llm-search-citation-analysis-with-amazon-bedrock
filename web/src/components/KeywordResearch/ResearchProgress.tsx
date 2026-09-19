import type {
  KeywordResearchItem, ResearchStatus, ResearchStep
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
  serpapi: 'Google signals',
};

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

/**
 * The copy that differs between the two kinds of run: an agent job runs one
 * step per planned query, in rounds; a provider job runs one step per provider.
 */
interface ProgressCopy {
  unit: string;
  planning: string;
  retry: string;
  stepsLabel: string;
  stepsGrid: string;
}

const AGENT_COPY: ProgressCopy = {
  unit: 'steps',
  planning: 'Planning the first round…',
  retry: 'Retry failed steps',
  stepsLabel: 'Research steps',
  stepsGrid: 'sm:grid-cols-2',
};

const PROVIDER_COPY: ProgressCopy = {
  unit: 'providers',
  planning: 'Planning providers…',
  retry: 'Retry failed providers',
  stepsLabel: 'Provider steps',
  stepsGrid: 'sm:grid-cols-3',
};

function progressCopy(job: KeywordResearchItem): ProgressCopy {
  return job.type === 'agent' ? AGENT_COPY : PROVIDER_COPY;
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
  const active = isActiveResearchStatus(status);
  const copy = progressCopy(job);
  const canRetry = onRetry !== undefined && isRetryableResearchStatus(status) && !retrying;

  return (
    <section
      aria-live="polite"
      aria-label="Research progress"
      className="bg-white rounded-lg border border-gray-200 p-4 space-y-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <ProgressSummary job={job} status={status} steps={steps} copy={copy} />
        {canRetry && (
          <button
            type="button"
            onClick={() => onRetry(job)}
            className="px-3 py-1.5 text-sm font-medium text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {copy.retry}
          </button>
        )}
      </div>

      {steps.length > 0 && (
        <ul className={`grid grid-cols-1 gap-2 ${copy.stepsGrid}`} aria-label={copy.stepsLabel}>
          {steps.map((step) => <StepRow key={step.step_id} step={step} />)}
        </ul>
      )}

      {!active && <JobFailureMessage message={job.error_message} />}
    </section>
  );
};

interface ProgressSummaryProps {
  job: KeywordResearchItem;
  status: ResearchStatus;
  steps: ResearchStep[];
  copy: ProgressCopy;
}

function isFinishedStep(step: ResearchStep): boolean {
  return step.status === 'completed' || step.status === 'failed';
}

/** An agent run collects candidates until it stops; everything else counts keywords. */
function foundUnit(job: KeywordResearchItem, active: boolean): string {
  return job.type === 'agent' && active ? 'candidates' : 'keywords';
}

/** Status badge, steps finished out of steps planned, and what has been found so far. */
const ProgressSummary = ({
  job, status, steps, copy
}: ProgressSummaryProps) => {
  const active = isActiveResearchStatus(status);
  const total = job.steps_total ?? steps.length;
  const done = job.steps_done ?? steps.filter(isFinishedStep).length;
  const progressText = `${done} of ${total} ${copy.unit} finished${roundLabel(job)}`;

  return (
    <div className="flex items-center gap-3">
      {active && <Spinner size="sm" className="text-gray-400" />}
      <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getResearchStatusClass(status)}`}>
        {getResearchStatusLabel(status)}
      </span>
      <span className="text-sm text-gray-700">
        {total > 0 ? progressText : copy.planning}
      </span>
      {job.keyword_count > 0 && (
        <span className="text-sm text-gray-500">· {job.keyword_count} {foundUnit(job, active)} so far</span>
      )}
    </div>
  );
};

/** The job-level failure reason, shown once the run has stopped. */
const JobFailureMessage = ({ message }: { message?: string }) => {
  if (message === undefined || message === '') return null;

  return (
    <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded px-2 py-1" title={message}>
      {formatResearchFailureMessage(message)}
    </p>
  );
};

/** " · round 2 of 3" for an agent job past planning; empty otherwise. */
function roundLabel(job: KeywordResearchItem): string {
  const round = job.round ?? 0;
  if (job.type !== 'agent' || round === 0) return '';
  const cap = job.config === undefined ? '' : ` of ${job.config.max_rounds}`;
  return ` · round ${round}${cap}`;
}

function stepSubtitle(step: ResearchStep): string {
  const round = step.round === undefined ? '' : ` · round ${step.round}`;
  return `${providerLabel(step.provider)}${round}`;
}

function stepTitle(step: ResearchStep): string {
  if (step.query) return step.query;
  if (step.query_count !== undefined) return `Google signals for ${step.query_count} quer${step.query_count === 1 ? 'y' : 'ies'}`;
  return providerLabel(step.provider);
}

const StepRow = ({ step }: { step: ResearchStep }) => (
  <li className="flex flex-col gap-0.5 rounded-lg border border-gray-100 bg-gray-50 px-3 py-2 text-xs">
    <div className="flex items-center justify-between gap-2">
      <span className="font-medium text-gray-900 truncate" title={stepTitle(step)}>{stepTitle(step)}</span>
      <span className={`font-medium shrink-0 ${getResearchStepStatusClass(step.status)}`}>
        {getResearchStepStatusLabel(step.status)}
      </span>
    </div>
    {(step.query !== undefined || step.query_count !== undefined) && (
      <span className="text-gray-500">{stepSubtitle(step)}</span>
    )}
    {step.status === 'completed' && (
      <span className="text-gray-500">{step.keyword_count} keywords</span>
    )}
    {step.status === 'failed' && step.error_message && (
      <span className="text-red-700 truncate" title={step.error_message}>{step.error_message}</span>
    )}
  </li>
);
