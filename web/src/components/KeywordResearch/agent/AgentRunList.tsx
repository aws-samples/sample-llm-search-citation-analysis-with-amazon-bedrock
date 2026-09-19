import type {
  KeywordResearchItem, ResearchStatus
} from '../../../types';
import {
  getResearchStatusClass,
  getResearchStatusLabel,
  isActiveResearchStatus,
  isRetryableResearchStatus,
  resolveResearchStatus,
} from '../../../formatting/researchStatus';
import { Button } from '../../ui';
import { Spinner } from '../../ui/Spinner';

interface AgentRunListProps {
  readonly jobs: KeywordResearchItem[];
  readonly loading: boolean;
  readonly onSelect: (id: string) => void;
  readonly onRetry: (job: KeywordResearchItem) => void;
  readonly onDelete: (id: string) => void;
}

function formatWhen(timestamp: string): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? timestamp : date.toLocaleString();
}

/** One line of progress for a run card: rounds, steps and what has been found. */
export function describeRunProgress(job: KeywordResearchItem): string {
  const status = resolveResearchStatus(job.status);
  const round = job.round ?? 0;
  const maxRounds = job.config?.max_rounds ?? round;
  const roundText = round > 0 ? `round ${round}/${maxRounds}` : 'planning';
  if (status !== null && isActiveResearchStatus(status)) {
    const done = job.steps_done ?? 0;
    const total = job.steps_total ?? 0;
    const steps = total > 0 ? ` · ${done}/${total} steps` : '';
    return `${roundText}${steps} · ${job.keyword_count} candidates so far`;
  }
  const rounds = job.rounds?.length ?? round;
  const candidates = job.candidates_count ?? 0;
  return `${rounds} round${rounds === 1 ? '' : 's'} · ${candidates} candidates · ${job.keyword_count} proposed`;
}

/** What opening the run shows: its progress while active, the failure for a failed run, the proposal otherwise. */
export function runActionLabel(status: ResearchStatus): string {
  if (isActiveResearchStatus(status)) return 'View progress';
  return status === 'failed' ? 'View details' : 'View results';
}

/**
 * Every agent run, newest first. Running ones keep updating while the user
 * fills in the next brief; the primary button opens the run's results (or
 * progress) in the modal.
 */
export function AgentRunList({
  jobs, loading, onSelect, onRetry, onDelete
}: AgentRunListProps) {
  if (loading && jobs.length === 0) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
        <Spinner size="sm" className="text-gray-400" />
        Loading runs…
      </div>
    );
  }
  if (jobs.length === 0) {
    return <p className="text-sm text-gray-500 py-4">No research runs yet. Start one with the brief above.</p>;
  }

  return (
    <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200 bg-white" aria-label="Research runs">
      {jobs.map((job) => {
        const status = resolveResearchStatus(job.status) ?? 'pending';
        const active = isActiveResearchStatus(status);
        const seed = job.config?.seed ?? job.seed_keyword ?? 'Research run';
        return (
          <li key={job.id} className="flex flex-col sm:flex-row sm:items-center gap-3 p-3 sm:p-4">
            <div className="flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {active && <Spinner size="sm" className="text-gray-400" />}
                <span className={`inline-flex px-2 py-0.5 text-xs font-medium rounded-full ${getResearchStatusClass(status)}`}>
                  {getResearchStatusLabel(status)}
                </span>
                <span className="text-sm font-medium text-gray-900 truncate">{seed}</span>
                {job.template_name && <span className="text-xs text-gray-500 truncate">· {job.template_name}</span>}
              </div>
              <p className="text-xs text-gray-500 mt-1">{describeRunProgress(job)} · {formatWhen(job.created_at)}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Button type="button" size="sm" onClick={() => onSelect(job.id)} aria-label={`${runActionLabel(status)} of ${seed}`}>
                {runActionLabel(status)}
              </Button>
              {isRetryableResearchStatus(status) && (
                <Button type="button" variant="secondary" size="sm" onClick={() => onRetry(job)}>Retry</Button>
              )}
              {!active && (
                <Button type="button" variant="ghost" size="sm" onClick={() => onDelete(job.id)} aria-label={`Delete run ${seed}`}>
                  Delete
                </Button>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
