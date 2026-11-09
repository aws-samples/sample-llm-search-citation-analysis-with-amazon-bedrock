/**
 * Lighthouse tab: measure one of the brand's own pages on mobile or desktop (one paid run on a click; the URL
 * starts from the brand's homepage and suggests the latest audit's pages), or
 * the latest audit's sample pages (Admin, confirmed), and reopen the 20 newest runs.
 */
import {
  fetchLighthouseRuns, fetchLighthouseSample, startLighthouse, startLighthouseBatch
} from '../../../api/seoPerformance';
import { useIsAdmin } from '../../../hooks/useIsAdmin';
import { useSiteAuditLoad } from '../../../hooks/useSiteAuditLoad';
import { usePerformanceRun } from '../../../hooks/usePerformanceRun';
import type {
  LighthouseRunHeader, StartRunResponse
} from '../../../types/api/seoPerformance';
import { Button } from '../../ui/Button';
import { LighthouseBatch } from './LighthouseBatch';
import { LighthouseRunPanel } from './LighthouseRunPanel';
import { MeasurePageForm } from './MeasurePageForm';
import { useAuditPageSuggestions } from './ownedPages';

function RecentRuns({
  runs, onOpen
}: {
  readonly runs: readonly LighthouseRunHeader[];
  readonly onOpen: (runId: string) => void;
}) {
  if (runs.length === 0) return null;
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4" aria-label="Recent runs">
      <h3 className="text-base font-semibold text-gray-900">Recent runs</h3>
      <ul className="mt-2 divide-y divide-gray-100 dark:divide-gray-700 text-sm">
        {runs.map((run) => (
          <li key={run.run_id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="break-all text-gray-800 dark:text-gray-200">
              {run.kind === 'batch' ? `Audit sample (${String(run.target_count)} runs)` : run.first_url}
              <span className="ml-2 text-xs text-gray-500">{run.created_at.slice(0, 16).replace('T', ' ')} · {run.status}</span>
            </span>
            <Button variant="secondary" size="sm" onClick={() => { onOpen(run.run_id); }}>Show</Button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function LighthouseTab() {
  const { isAdmin } = useIsAdmin();
  const run = usePerformanceRun();
  const runs = useSiteAuditLoad('lighthouse-runs', (signal) => fetchLighthouseRuns({ signal }));
  const sample = useSiteAuditLoad('lighthouse-sample', (signal) => fetchLighthouseSample({ signal }));
  const suggestions = useAuditPageSuggestions(sample.state);
  const busy = run.state.status === 'starting' || run.state.status === 'running';

  const begin = (starter: () => Promise<StartRunResponse>) => {
    void run.start(starter).then(runs.reload);
  };

  return (
    <div className="space-y-4">
      <MeasurePageForm
        suggestions={suggestions.pages}
        onWantSuggestions={suggestions.load}
        busy={busy}
        onMeasure={(url, device) => { begin(() => startLighthouse({
          url,
          device
        })); }}
      />
      <LighthouseRunPanel state={run.state} />
      <LighthouseBatch
        sample={sample.state}
        isAdmin={isAdmin}
        busy={busy}
        onRun={(auditId) => { begin(() => startLighthouseBatch(auditId)); }}
      />
      {runs.state.status === 'success' && <RecentRuns runs={runs.state.value} onOpen={(runId) => { void run.open(runId); }} />}
    </div>
  );
}
