import type { ContentBriefBatchStatusResponse } from '../../types';
import { Spinner } from '../ui/Spinner';

interface ContentBriefBatchProgressProps { readonly batch: ContentBriefBatchStatusResponse; }

export function ContentBriefBatchProgress({ batch }: ContentBriefBatchProgressProps) {
  const running = batch.counts.pending + batch.counts.generating;
  const settled = batch.counts.generated + batch.counts.failed + batch.counts.missing;
  const failedNoun = batch.counts.failed === 1 ? 'brief has' : 'briefs have';
  const missingNoun = batch.counts.missing === 1 ? 'brief is' : 'briefs are';
  return (
    <section
      aria-label={`Content Brief batch ${batch.batch_id} progress`}
      className="rounded-xl border border-blue-200 bg-blue-50 p-4"
    >
      <div className="flex items-center gap-3">
        {running > 0 && <Spinner size="sm" />}
        <div>
          <p className="text-xs font-medium text-blue-700">Batch {batch.batch_id}</p>
          <p className="text-sm font-semibold text-blue-900">
            Content Brief batch: {settled} of {batch.counts.total} jobs settled
          </p>
          <p className="mt-1 text-xs text-blue-800">
            {batch.counts.generated} generated, {batch.counts.generating} generating,{' '}
            {batch.counts.pending} pending, {batch.counts.failed} failed,{' '}
            {batch.counts.missing} missing
          </p>
        </div>
      </div>
      {batch.counts.failed > 0 && (
        <p className="mt-2 text-sm text-red-700">
          {batch.counts.failed} {failedNoun} failed. Successful background jobs are preserved.
        </p>
      )}
      {batch.counts.missing > 0 && (
        <p className="mt-2 text-sm text-amber-800">
          {batch.counts.missing} {missingNoun} unavailable. Manifest positions are preserved,
          but no generated content is available for those jobs.
        </p>
      )}
    </section>
  );
}
