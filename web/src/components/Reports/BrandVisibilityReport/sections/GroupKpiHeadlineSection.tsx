import { useId } from 'react';
import type { GroupRun } from '../../../../types/domain/groupKpiHistory';
import { formatDate } from '../../../../formatting/dateFormatter';
import {
  CITATION_RATE_DEFINITION, PROMINENCE_DEFINITION, SHARE_OF_VOICE_DEFINITION
} from '../../../../constants/kpiDefinitions';
import {
  ReportSection, ReportStatCard, ReportStatGrid
} from '../../layout';
import {
  deltaAccent, formatPercent, formatPointsDelta, formatRank
} from '../groupKpiView';

interface Props {
  /** Every run in the window, oldest first. */
  readonly runs: readonly GroupRun[];
  readonly selected: GroupRun;
  readonly onSelect: (timestamp: string) => void;
}

function changeFootnote(run: GroupRun, delta: number | null | undefined): string {
  if (run.change === null) return 'No earlier group run to compare with';
  return `${formatPointsDelta(delta ?? null)} since ${formatDate(run.change.previous_timestamp)}`;
}

function runOptionLabel(run: GroupRun): string {
  const partial = run.is_group_run ? '' : ' (partial)';
  return `${formatDate(run.timestamp)} · ${run.keywords_with_data}/${run.keywords_total} keywords${partial}`;
}

/**
 * The hotel's three KPIs for one run (the latest group run by default), each
 * with its change since the previous group run and a tooltip saying exactly
 * how it is measured.
 */
export function GroupKpiHeadlineSection({
  runs, selected, onSelect
}: Props) {
  const pickerId = useId();
  const { summary } = selected;
  const deltas = selected.change?.deltas;

  return (
    <ReportSection
      title="Headline"
      subtitle={`Run of ${formatDate(selected.timestamp)} — ${selected.keywords_with_data} of ${selected.keywords_total} keywords with results.`}
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
      <ReportStatGrid columns={3}>
        <ReportStatCard
          label={CITATION_RATE_DEFINITION.label}
          value={formatPercent(summary.coverage_rate)}
          footnote={changeFootnote(selected, deltas?.coverage_rate)}
          accent={deltaAccent(deltas?.coverage_rate ?? null, true)}
          info={CITATION_RATE_DEFINITION.definition}
        />
        <ReportStatCard
          label={SHARE_OF_VOICE_DEFINITION.label}
          value={formatPercent(summary.first_party_avg_sov)}
          footnote={changeFootnote(selected, deltas?.first_party_avg_sov)}
          accent={deltaAccent(deltas?.first_party_avg_sov ?? null, true)}
          info={SHARE_OF_VOICE_DEFINITION.definition}
        />
        <ReportStatCard
          label={`${PROMINENCE_DEFINITION.label} (rank #1)`}
          value={formatPercent(summary.rank_1_share)}
          footnote={`Top 3: ${formatPercent(summary.top_3_share)} · Mean rank: ${formatRank(summary.mean_rank)}`}
          accent={deltaAccent(deltas?.rank_1_share ?? null, true)}
          info={PROMINENCE_DEFINITION.definition}
        />
      </ReportStatGrid>
    </ReportSection>
  );
}
