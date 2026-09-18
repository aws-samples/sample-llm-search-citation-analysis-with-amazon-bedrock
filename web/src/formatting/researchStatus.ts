import { formatApproximateDuration } from './dateFormatter';
import type {
  ResearchStatus, ResearchStepStatus
} from '../types';

/**
 * Display copy for keyword-research jobs and their provider steps.
 *
 * A row the backend marked `failed` used to render identically to a genuine
 * "0 keywords" result, so five stranded production runs looked like empty ones.
 * Since 2.2.0 a job can also be `partial`: some providers answered, others
 * failed, and the failed steps can be retried on their own.
 */

const STATUS_LABELS: Record<ResearchStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  processing: 'Running',
  completed: 'Completed',
  partial: 'Partial',
  failed: 'Failed',
};

const STATUS_CLASSES: Record<ResearchStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  running: 'bg-blue-100 text-blue-700',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  partial: 'bg-amber-100 text-amber-700',
  failed: 'bg-red-100 text-red-700',
};

const STEP_STATUS_LABELS: Record<ResearchStepStatus, string> = {
  pending: 'Waiting',
  running: 'Querying',
  completed: 'Done',
  failed: 'Failed',
};

const STEP_STATUS_CLASSES: Record<ResearchStepStatus, string> = {
  pending: 'text-gray-500',
  running: 'text-blue-700',
  completed: 'text-emerald-700',
  failed: 'text-red-700',
};

const RESEARCH_STATUSES: ResearchStatus[] = ['pending', 'running', 'processing', 'completed', 'partial', 'failed'];
const ACTIVE_STATUSES: ResearchStatus[] = ['pending', 'running', 'processing'];
const RETRYABLE_STATUSES: ResearchStatus[] = ['partial', 'failed'];

/** Rows written before the status field existed carry no status at all. */
export function resolveResearchStatus(status: string | undefined): ResearchStatus | null {
  return RESEARCH_STATUSES.find((known) => known === status) ?? null;
}

/** Whether the job is still being worked on and should keep being polled. */
export function isActiveResearchStatus(status: string | undefined): boolean {
  return ACTIVE_STATUSES.some((known) => known === status);
}

/** Whether the job has failed steps that `POST /{id}/retry` would re-run. */
export function isRetryableResearchStatus(status: string | undefined): boolean {
  return RETRYABLE_STATUSES.some((known) => known === status);
}

export function getResearchStatusLabel(status: ResearchStatus): string {
  return STATUS_LABELS[status];
}

export function getResearchStatusClass(status: ResearchStatus): string {
  return STATUS_CLASSES[status];
}

export function getResearchStepStatusLabel(status: ResearchStepStatus): string {
  return STEP_STATUS_LABELS[status];
}

export function getResearchStepStatusClass(status: ResearchStepStatus): string {
  return STEP_STATUS_CLASSES[status];
}

/**
 * Matches the raw second counts the timeout sweep writes, e.g.
 * "Research timed out after 4434821 seconds. Please try again."
 */
const RAW_SECONDS_PATTERN = /(\d{1,15}) seconds\b/g;

/**
 * Rewrites embedded second counts into coarse units: 4434821 seconds becomes
 * "51 days".
 *
 * The count is reformatted in place rather than recomputed from `created_at`
 * because it records how long the run had actually been stranded when the
 * sweep failed it. Deriving elapsed time from `created_at` at render time would
 * keep growing every day the row sits in history, reporting a wait that never
 * happened. Callers keep the raw string available for debugging.
 */
export function formatResearchFailureMessage(message: string): string {
  return message.replaceAll(
    RAW_SECONDS_PATTERN,
    (_match, digits: string) => formatApproximateDuration(Number(digits))
  );
}
