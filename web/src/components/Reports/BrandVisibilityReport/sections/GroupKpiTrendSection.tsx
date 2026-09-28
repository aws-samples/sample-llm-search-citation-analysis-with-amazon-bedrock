import {
  useId, useMemo
} from 'react';
import type { GroupRun } from '../../../../types/domain/groupKpiHistory';
import { formatDateOnly } from '../../../../formatting/dateFormatter';
import { useThemedChart } from '../../../Dashboard/useThemedChart';
import { ReportSection } from '../../layout';
import {
  groupRuns, modelChanges, type ModelChange
} from '../groupKpiView';
import { buildGroupKpiChartConfiguration } from './groupKpiChartConfiguration';

interface Props {
  readonly runs: readonly GroupRun[];
  /** % of the group's keywords a run must cover to count as a group run. */
  readonly minCoverage: number;
  readonly includePartial: boolean;
  readonly onIncludePartialChange: (include: boolean) => void;
}

function describeModelChange(change: ModelChange): string {
  return `${formatDateOnly(change.timestamp)} · ${change.provider}: ${change.from.join(', ')} → ${change.to.join(', ')}`;
}

/**
 * The group's citation rate, share of voice and prominence over time, one
 * point per run. Model changes are listed under the chart, because a new
 * model can move every KPI on its own.
 */
export function GroupKpiTrendSection({
  runs, minCoverage, includePartial, onIncludePartialChange
}: Props) {
  const toggleId = useId();
  // Stable identity: useThemedChart rebuilds the chart whenever `shown` changes.
  const shown = useMemo(() => (includePartial ? [...runs] : groupRuns(runs)), [runs, includePartial]);
  const { canvasRef } = useThemedChart(shown, buildGroupKpiChartConfiguration);
  const changes = modelChanges(runs);

  return (
    <ReportSection
      title="KPI evolution"
      subtitle={`One point per analysis run. Hollow points are partial runs (less than ${minCoverage}% of the group's keywords).`}
    >
      <label htmlFor={toggleId} className="mb-3 inline-flex items-center gap-2 text-xs text-gray-600 dark:text-gray-300 print-hidden">
        <input
          id={toggleId}
          type="checkbox"
          checked={includePartial}
          onChange={(event) => onIncludePartialChange(event.target.checked)}
        />
        Include partial runs
      </label>
      {shown.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No group run in this period yet.</p>
      ) : (
        <figure className="h-72">
          <canvas ref={canvasRef} />
          <figcaption className="sr-only">
            {`Citation rate, share of voice, rank #1 share and top-3 share over ${shown.length} runs.`}
          </figcaption>
        </figure>
      )}
      {changes.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-medium text-gray-700 dark:text-gray-300">Model changes</p>
          <ul className="mt-1 text-xs text-gray-600 dark:text-gray-400">
            {changes.map((change) => (
              // Stryker disable next-line StringLiteral: React list key only; the rendered items are identical
              <li key={`${change.timestamp}-${change.provider}`}>{describeModelChange(change)}</li>
            ))}
          </ul>
        </div>
      )}
    </ReportSection>
  );
}
