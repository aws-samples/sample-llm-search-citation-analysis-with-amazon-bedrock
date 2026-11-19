import type {
  ReextractJob, ReextractJobStatus
} from '../../../api/reextractDecoders';
import { formatDate } from '../../../formatting/dateFormatter';
import { isReextractActive } from '../../../hooks/useReextract';
import { Button } from '../../ui';
import { integerText } from '../../ui/numberFormat';

const STATUS_LABELS: Record<ReextractJobStatus, string> = {
  running: 'Re-extracting',
  stopping: 'Stopping',
  stopped: 'Stopped',
  done: 'Done',
  failed: 'Failed',
};

const STATUS_CLASSES: Record<ReextractJobStatus, string> = {
  running: 'text-gray-900',
  stopping: 'text-gray-900',
  stopped: 'text-amber-700',
  done: 'text-emerald-700',
  failed: 'text-red-700',
};

interface ReextractJobPanelProps {
  readonly job: ReextractJob;
  readonly stopping: boolean;
  readonly onStop: (jobId: string) => void;
}

function progressText(job: ReextractJob): string {
  return `${integerText(job.answers_done)} of ${integerText(job.answers_total)} answers · `
    + `${integerText(job.keywords_done)} of ${integerText(job.keywords_total)} keywords · `
    + `${integerText(job.answers_failed)} failed`;
}

function ProgressBar({ job }: { readonly job: ReextractJob }) {
  return (
    <progress
      aria-label="Answers re-extracted"
      max={Math.max(job.answers_total, 1)}
      value={job.answers_done}
      className="h-2 w-full accent-gray-900"
    />
  );
}

function FinishedDetails({ job }: { readonly job: ReextractJob }) {
  return (
    <>
      <p className="text-sm text-gray-500">Finished {formatDate(job.finished_at)}</p>
      {job.error !== null && <p className="text-sm text-red-700">{job.error}</p>}
      {job.rebuild === 'started' && <p className="text-sm text-gray-600">The KPIs are being rebuilt from the new results.</p>}
    </>
  );
}

/** The newest re-extract job: progress and Stop while it runs, the outcome once it ended. */
export function ReextractJobPanel({
  job, stopping, onStop
}: ReextractJobPanelProps) {
  const active = isReextractActive(job);
  return (
    <section aria-label="Re-extract job" className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm">
          <span className={`font-semibold ${STATUS_CLASSES[job.status]}`}>{STATUS_LABELS[job.status]}</span>
          <span className="text-gray-500"> · started {formatDate(job.created_at)} by {job.created_by}</span>
        </p>
        {job.status === 'running' && (
          <Button variant="secondary" size="sm" disabled={stopping} onClick={() => onStop(job.job_id)}>
            {stopping ? 'Stopping…' : 'Stop'}
          </Button>
        )}
      </div>
      {active && <ProgressBar job={job} />}
      <p className="text-sm text-gray-700" aria-live="polite">{progressText(job)}</p>
      {!active && <FinishedDetails job={job} />}
    </section>
  );
}
