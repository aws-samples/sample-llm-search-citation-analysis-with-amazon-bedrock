/** The Lighthouse run on screen: its progress while it runs, then one report per page and device. */
import type { RunState } from '../../../hooks/usePerformanceRun';
import { ErrorAlert } from '../../ui/ErrorAlert';
import {
  SkeletonLines, SkeletonRegion
} from '../../ui/Skeleton';
import { LighthouseReport } from './LighthouseReport';

export function LighthouseRunPanel({ state }: { readonly state: RunState }) {
  if (state.status === 'idle') return null;
  if (state.status === 'error') return <ErrorAlert message={state.message} />;
  if (state.status === 'starting') {
    return (
      <SkeletonRegion label="Starting the Lighthouse run" className="rounded-lg border border-gray-200 bg-white p-4">
        <SkeletonLines lines={4} />
      </SkeletonRegion>
    );
  }
  const {
    run, reused 
  } = state;
  return (
    <section className="space-y-3" aria-label="Lighthouse results">
      <output className="block text-sm text-gray-700">
        {run.status === 'failed' ? `Run failed: ${run.error ?? 'unknown error'}` : `${String(run.progress.done)} of ${String(run.progress.total)} measured`}
        {reused ? ' · already started in the last 15 minutes, so no new runs were started' : ''}
      </output>
      {run.targets.map((target, index) => (
        <LighthouseReport
          key={`${target.url}-${target.device}`}
          url={target.url}
          device={target.device}
          result={run.results[index] ?? null}
        />
      ))}
    </section>
  );
}
