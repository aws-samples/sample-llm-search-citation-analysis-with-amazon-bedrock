import { formatApproximateDuration } from './dateFormatter';
import type { ResearchStatus } from '../types';

/**
 * Display copy for keyword-research rows.
 *
 * A row the backend marked `failed` used to render identically to a genuine
 * "0 keywords" result, so five stranded production runs looked like empty ones.
 */

const STATUS_LABELS: Record<ResearchStatus, string> = {
  pending: 'Queued',
  processing: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const STATUS_CLASSES: Record<ResearchStatus, string> = {
  pending: 'bg-gray-100 text-gray-600',
  processing: 'bg-blue-100 text-blue-700',
  completed: 'bg-emerald-100 text-emerald-700',
  failed: 'bg-red-100 text-red-700',
};

const RESEARCH_STATUSES: ResearchStatus[] = ['pending', 'processing', 'completed', 'failed'];

/** Rows written before the status field existed carry no status at all. */
export function resolveResearchStatus(status: string | undefined): ResearchStatus | null {
  return RESEARCH_STATUSES.find((known) => known === status) ?? null;
}

export function getResearchStatusLabel(status: ResearchStatus): string {
  return STATUS_LABELS[status];
}

export function getResearchStatusClass(status: ResearchStatus): string {
  return STATUS_CLASSES[status];
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
