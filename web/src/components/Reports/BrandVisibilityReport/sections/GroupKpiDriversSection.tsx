import type {
  GroupRun, GroupRunDriver
} from '../../../../types/domain/groupKpiHistory';
import { formatDate } from '../../../../formatting/dateFormatter';
import { formatKpiDelta } from '../../../../formatting/kpiFormatter';
import {
  KPI_DEFINITIONS, type KpiId
} from '../../../../constants/kpiDefinitions';
import {
  emphasisColumn, kpiColumn, ReportSection, ReportTable, type ReportTableColumn
} from '../../layout';

interface Props {readonly run: GroupRun;}

const MENTION_LABELS = {
  gained: 'Now mentioned',
  lost: 'No longer mentioned',
} as const;

/** The group changes summarised above the drivers table. */
const SUMMARY_KPIS: readonly KpiId[] = [
  'mention_rate', 'share_of_voice', 'visibility_score', 'average_position', 'top_1_share', 'citation_rate',
];

const IMPACT_NOTE = 'Share of the group\'s change: the keyword\'s change weighted by its share of the run\'s answers.';

function deltaColumn(id: KpiId): ReportTableColumn<GroupRunDriver> {
  return kpiColumn(id, (driver) => formatKpiDelta(id, driver.deltas[id]));
}

/** Built per render (not at import) so every column is exercised by the tests that render the table. */
function driverColumns(): ReadonlyArray<ReportTableColumn<GroupRunDriver>> {
  return [
    emphasisColumn('Keyword', (driver) => driver.keyword),
    {
      header: 'Brand mention',
      info: 'Whether the keyword\'s answers started or stopped naming your brand since the previous group run.',
      render: (driver) => (driver.mention === null ? 'Unchanged' : MENTION_LABELS[driver.mention]),
    },
    deltaColumn('mention_rate'),
    {
      header: 'Mention rate impact',
      info: IMPACT_NOTE,
      render: (driver) => formatKpiDelta('mention_rate', driver.impact.mention_rate),
    },
    deltaColumn('visibility_score'),
    {
      header: 'Visibility impact',
      info: IMPACT_NOTE,
      render: (driver) => formatKpiDelta('visibility_score', driver.impact.visibility_score),
    },
    deltaColumn('share_of_voice'),
    deltaColumn('average_position'),
    deltaColumn('top_1_share'),
    deltaColumn('answers'),
  ];
}

function noComparisonMessage(run: GroupRun): string {
  return run.is_group_run
    ? 'This is the first group run in the selected period, so there is nothing to compare it with.'
    : 'This is a partial run (less than half of the group\'s keywords); it is not compared with group runs. See the keyword detail below.';
}

/**
 * What moved the group's KPIs between the selected group run and the one
 * before it: the group changes, then every keyword that changed, largest
 * mention-rate impact first.
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
      subtitle={`Since the group run of ${formatDate(change.previous_timestamp)}. ${IMPACT_NOTE}`}
    >
      <p className="mb-3 text-sm text-gray-700 dark:text-gray-300">
        {SUMMARY_KPIS.map((id) => `${KPI_DEFINITIONS[id].label} ${formatKpiDelta(id, change.deltas[id])}`).join(' · ')}
      </p>
      {change.drivers.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No keyword changed between these runs.</p>
      ) : (
        // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
        <ReportTable columns={driverColumns()} rows={change.drivers} rowKey={(driver) => driver.keyword} />
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
