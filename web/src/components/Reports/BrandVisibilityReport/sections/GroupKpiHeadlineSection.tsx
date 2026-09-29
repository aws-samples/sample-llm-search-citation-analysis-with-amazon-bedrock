import { useId } from 'react';
import type { GroupRun } from '../../../../types/domain/groupKpiHistory';
import { formatDate } from '../../../../formatting/dateFormatter';
import {
  KpiHeadline, ReportSection, type KpiComparison
} from '../../layout';

interface Props {
  /** Every run in the window, oldest first. */
  readonly runs: readonly GroupRun[];
  readonly selected: GroupRun;
  readonly onSelect: (timestamp: string) => void;
  /** Whether owned domains are configured, so the citation KPIs are measured. */
  readonly citationsConfigured: boolean;
}

function runOptionLabel(run: GroupRun): string {
  const partial = run.is_group_run ? '' : ' (partial)';
  return `${formatDate(run.timestamp)} · ${run.keywords_with_data}/${run.keywords_total} keywords${partial}`;
}

function runComparison(run: GroupRun): KpiComparison | null {
  const { change } = run;
  return change === null ? null : {
    deltas: change.deltas,
    trends: change.trends,
    label: `since ${formatDate(change.previous_timestamp)}`,
  };
}

/**
 * The group's KPIs for one run (the latest group run by default), with each
 * change and trend since the previous group run.
 */
export function GroupKpiHeadlineSection({
  runs, selected, onSelect, citationsConfigured
}: Props) {
  const pickerId = useId();
  const { kpis } = selected;

  return (
    <ReportSection
      title="Headline"
      subtitle={`Run of ${formatDate(selected.timestamp)} — ${kpis.answers ?? 0} AI answers from ${kpis.engines} engines `
        + `across ${selected.keywords_with_data} of ${selected.keywords_total} keywords.`}
    >
      <div className="mb-3 print-hidden">
        <label htmlFor={pickerId} className="mr-2 text-xs text-gray-600 dark:text-gray-300">Run</label>
        <select
          id={pickerId}
          value={selected.timestamp}
          onChange={(event) => onSelect(event.target.value)}
          className="rounded-lg border border-gray-200 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
        >
          {[...runs].reverse().map((run) => (
            <option key={run.timestamp} value={run.timestamp}>{runOptionLabel(run)}</option>
          ))}
        </select>
      </div>
      <KpiHeadline
        kpis={kpis}
        comparison={runComparison(selected)}
        noComparisonNote="No earlier group run to compare with"
        citationsConfigured={citationsConfigured}
      />
    </ReportSection>
  );
}
