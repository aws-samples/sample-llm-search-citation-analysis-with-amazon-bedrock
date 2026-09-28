import type {
  GroupRun, GroupRunDriver
} from '../../../../types/domain/groupKpiHistory';
import { formatDate } from '../../../../formatting/dateFormatter';
import {
  ReportSection, ReportTable, type ReportTableColumn
} from '../../layout';
import {
  formatPointsDelta, formatRankDelta
} from '../groupKpiView';

interface Props {readonly run: GroupRun;}

const MENTION_LABELS = {
  gained: 'Now mentioned',
  lost: 'No longer mentioned',
} as const;

const DRIVER_COLUMNS: ReadonlyArray<ReportTableColumn<GroupRunDriver>> = [
  {
    header: 'Keyword',
    // Stryker disable next-line StringLiteral: Tailwind-only cell styling
    cellClassName: 'font-medium',
    render: (driver) => driver.keyword,
  },
  {
    header: 'Hotel mention',
    render: (driver) => (driver.changes.mention === null ? 'Unchanged' : MENTION_LABELS[driver.changes.mention]),
  },
  {
    header: 'Citation rate impact',
    render: (driver) => formatPointsDelta(driver.impact.coverage_rate),
  },
  {
    header: 'Share of voice',
    render: (driver) => formatPointsDelta(driver.changes.first_party_sov),
  },
  {
    header: 'SOV impact',
    render: (driver) => formatPointsDelta(driver.impact.first_party_avg_sov),
  },
  {
    header: 'Rank #1 share',
    render: (driver) => formatPointsDelta(driver.changes.rank_1_share),
  },
  {
    header: 'Top-3 share',
    render: (driver) => formatPointsDelta(driver.changes.top_3_share),
  },
  {
    header: 'Mean rank',
    render: (driver) => formatRankDelta(driver.changes.mean_rank),
  },
];

function noComparisonMessage(run: GroupRun): string {
  return run.is_group_run
    ? 'This is the first group run in the selected period, so there is nothing to compare it with.'
    : 'This is a partial run (less than half of the group\'s keywords); it is not compared with group runs. See the keyword detail below.';
}

/**
 * What moved the hotel's KPIs between the selected group run and the one
 * before it: the group deltas, then every keyword that changed, largest
 * citation-rate impact first. "Impact" is the keyword's change divided by the
 * keywords with results: its share of the group's move.
 */
export function GroupKpiDriversSection({ run }: Props) {
  const { change } = run;
  if (change === null) {
    return (
      <ReportSection title="What changed">
        <p className="text-sm text-gray-500 dark:text-gray-400">{noComparisonMessage(run)}</p>
      </ReportSection>
    );
  }

  return (
    <ReportSection
      title="What changed"
      subtitle={`Since the group run of ${formatDate(change.previous_timestamp)}. Impact = the keyword's change divided by the keywords with results.`}
    >
      <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
        {`Citation rate ${formatPointsDelta(change.deltas.coverage_rate)} · Share of voice ${formatPointsDelta(change.deltas.first_party_avg_sov)} · `}
        {`Rank #1 share ${formatPointsDelta(change.deltas.rank_1_share)} · Top-3 share ${formatPointsDelta(change.deltas.top_3_share)} · `}
        {`Mean rank ${formatRankDelta(change.deltas.mean_rank)}`}
      </p>
      {change.drivers.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No keyword changed between these runs.</p>
      ) : (
        // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
        <ReportTable columns={DRIVER_COLUMNS} rows={change.drivers} rowKey={(driver) => driver.keyword} />
      )}
      {change.keywords_entered.length > 0 && (
        <p className="mt-2 text-xs text-gray-600 dark:text-gray-400">{`New in this run: ${change.keywords_entered.join(', ')}`}</p>
      )}
      {change.keywords_left.length > 0 && (
        <p className="mt-1 text-xs text-gray-600 dark:text-gray-400">{`Missing from this run: ${change.keywords_left.join(', ')}`}</p>
      )}
    </ReportSection>
  );
}
