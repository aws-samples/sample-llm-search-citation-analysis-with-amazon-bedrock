/** IndexNow tab: key setup and checks, submission, and the 20 newest submissions. */
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import { usePerformanceIndexNow } from '../../../hooks/usePerformanceIndexNow';
import type { IndexNowSubmission } from '../../../types/api/seoPerformance';
import { ErrorAlert } from '../../ui/ErrorAlert';
import {
  SkeletonLines, SkeletonRegion
} from '../../ui/Skeleton';
import { IndexNowKeys } from './IndexNowKeys';
import {
  HostOutcome, IndexNowSubmit
} from './IndexNowSubmit';

function SubmissionHistory({ history }: { readonly history: readonly IndexNowSubmission[] }) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="Submission history">
      <h3 className="text-base font-semibold text-gray-900">Last 20 submissions</h3>
      {history.length === 0
        ? <p className="mt-2 text-sm text-gray-600">Nothing submitted yet.</p>
        : (
          <ol className="mt-2 divide-y divide-gray-100 dark:divide-gray-700 text-sm">
            {history.map((entry) => (
              <li key={`${entry.submitted_at}-${entry.submitted_by}`} className="py-2">
                <p className="text-gray-800 dark:text-gray-200">
                  {entry.submitted_at.slice(0, 16).replace('T', ' ')} · {String(entry.url_count)} URLs
                  {entry.source === 'audit' ? ' from the latest audit' : ''} · by {entry.submitted_by}
                  {entry.skipped_count > 0 ? ` · ${String(entry.skipped_count)} skipped` : ''}
                </p>
                <ul>{entry.hosts.map((host) => <HostOutcome key={host.host} host={host} />)}</ul>
              </li>
            ))}
          </ol>
        )}
    </section>
  );
}

export function IndexNowTab() {
  const { isAdmin } = useIsAdmin();
  const controller = usePerformanceIndexNow();
  const { setup } = controller;
  if (setup.status === 'loading') {
    return (
      <SkeletonRegion label="Loading IndexNow" className="rounded-lg border border-gray-200 bg-white p-4">
        <SkeletonLines lines={5} />
      </SkeletonRegion>
    );
  }
  if (setup.status === 'error') return <ErrorAlert message={setup.message} />;
  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-600">
        IndexNow tells Bing, Yandex, Yep and the other participating engines that pages changed, so they crawl
        them sooner. Engines share every submission, so one accepted request reaches all of them.
      </p>
      <IndexNowKeys sites={setup.value.sites} controller={controller} isAdmin={isAdmin} />
      <IndexNowSubmit controller={controller} isAdmin={isAdmin} maxUrls={setup.value.max_urls} />
      <SubmissionHistory history={setup.value.history} />
    </div>
  );
}
