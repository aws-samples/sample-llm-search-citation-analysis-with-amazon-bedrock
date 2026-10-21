import type {
  GroupRun, GroupRunChange, GroupRunDriver
} from '../../../../types/domain/groupKpiHistory';
import type { ReportScope } from '../../../../types';
import { formatDate } from '../../../../formatting/dateFormatter';
import { formatKpiDelta } from '../../../../formatting/kpiFormatter';
import {
  KPI_DEFINITIONS, type KpiId
} from '../../../../constants/kpiDefinitions';
import { useRunDrivers } from '../../../../hooks/useGroupKpiDetail';
import {
  emphasisColumn, kpiColumn, ReportSection, ReportTable, type ReportTableColumn
} from '../../layout';

interface Props {
  /** The group the run belongs to: its drivers are read on demand. */
  readonly scope: ReportScope;
  readonly run: GroupRun;
}

const MENTION_LABELS = {
  gained: 'Now mentioned',
  lost: 'No longer mentioned',
} as const;

/** The group changes summarised above the drivers table. */
const SUMMARY_KPIS: readonly KpiId[] = [
  'mention_rate', 'share_of_voice', 'visibility_score', 'average_position', 'top_1_share', 'citation_rate',
];

const IMPACT_NOTE = 'Share of the group\'s change: the keyword\'s change weighted by its share of the run\'s answers.';

const NOTE_CLASS = 'text-sm text-gray-500 dark:text-gray-400';

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

interface DriversTableProps {
  readonly scope: ReportScope;
  readonly run: string;
  readonly change: GroupRunChange;
}

/** The drivers of one compared run, read when it is shown. */
function DriversTable({
  scope, run, change
}: DriversTableProps) {
  const {
    drivers, loading, error
  } = useRunDrivers(scope, run, change);
  if (error !== null) {
    return <p role="alert" className="text-sm text-red-700">{`Could not load the keywords behind this change: ${error}`}</p>;
  }
  if (loading || drivers === null) {
    return <p className={NOTE_CLASS}>{`Loading the ${change.drivers_count} keywords behind this change…`}</p>;
  }
  // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
  return <ReportTable columns={driverColumns()} rows={drivers} rowKey={(driver) => driver.keyword} />;
}

/**
 * What moved the group's KPIs between the selected group run and the one
 * before it: the group changes, then every keyword that changed, largest
 * mention-rate impact first.
 */
export function GroupKpiDriversSection({
  scope, run
}: Props) {
  const { change } = run;
  if (change === null) {
    return (
      <ReportSection title="What changed">
        <p className={NOTE_CLASS}>{noComparisonMessage(run)}</p>
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
      {change.drivers_count === 0 ? (
        <p className={NOTE_CLASS}>No keyword changed between these runs.</p>
      ) : (
        <DriversTable scope={scope} run={run.timestamp} change={change} />
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
