import {
  useId, useState
} from 'react';
import type {
  GroupKpiHistoryResponse, GroupRun, KeywordRunSummary
} from '../../../types/domain/groupKpiHistory';
import type { ReportScope } from '../../../types';
import {
  gateSection, KpiDefinitionsSection, type SectionFetchState
} from '../layout';
import type { SectionGate } from '../layout/sectionGate';
import { latestGroupRun } from './groupKpiView';
import { GroupKpiHeadlineSection } from './sections/GroupKpiHeadlineSection';
import { GroupKpiTrendSection } from './sections/GroupKpiTrendSection';
import { GroupKpiDriversSection } from './sections/GroupKpiDriversSection';
import { KeywordRunsSection } from './sections/KeywordRunsSection';
import { GroupKpiExportButton } from './GroupKpiExportButton';
import { GROUP_REPORT_DEFINITIONS } from '../../../constants/kpiDefinitions';
import { formatDate } from '../../../formatting/dateFormatter';

/** The periods the report offers, in days. */
const GROUP_REPORT_PERIODS = [30, 90, 180, 365] as const;

interface HistoryGateOptions extends SectionFetchState {
  readonly title: string;
  readonly history: GroupKpiHistoryResponse | null;
  readonly days: number;
}

interface Props extends Omit<HistoryGateOptions, 'title'> {
  /** The keyword group the report covers, and its name for the export. */
  readonly scope: ReportScope;
  readonly scopeLabel: string;
  readonly onDaysChange: (days: number) => void;
}

/** The chosen run if it is still in the window, else the latest group run, else the latest run. */
export function resolveRun(runs: readonly GroupRun[], timestamp: string | null): GroupRun {
  return runs.find((run) => run.timestamp === timestamp) ?? latestGroupRun(runs) ?? runs[runs.length - 1];
}

/** The chosen keyword if the group still has it, else the first keyword with runs, else the first keyword. */
export function resolveKeyword(keywords: readonly KeywordRunSummary[], keyword: string | null): KeywordRunSummary | null {
  return keywords.find((entry) => entry.keyword === keyword)
    ?? keywords.find((entry) => entry.runs_count > 0)
    ?? keywords[0]
    ?? null;
}

/** Which runs the report covers when the read was cut short; `null` when it covers the whole period. */
function coveredRuns(history: GroupKpiHistoryResponse): string | null {
  if (history.truncated_before !== null) return `after ${formatDate(history.truncated_before)}`;
  const oldestShown = history.runs_truncated ? history.runs[0]?.timestamp : undefined;
  return oldestShown === undefined ? null : `from ${formatDate(oldestShown)} on`;
}

/** Why the report starts later than the period: the period holds more data than one report reads. */
export function HistoryCutNote({ history }: { readonly history: GroupKpiHistoryResponse }) {
  const covers = coveredRuns(history);
  if (covers === null) return null;
  return (
    <p role="note" className="mb-4 text-xs text-amber-700 dark:text-amber-400">
      {`This period holds more analysis data than one report reads; the report covers the runs ${covers}. Choose a shorter period for the rest.`}
    </p>
  );
}

/** A group section's loading, error and "no run in the period" states; ready once the group has a run. */
export function gateGroupHistory({
  title, history, loading, error, days
}: HistoryGateOptions): SectionGate<GroupKpiHistoryResponse> {
  return gateSection({
    title,
    loading,
    loadingMessage: 'Loading the group KPI history…',
    error,
    value: history !== null && history.runs.length > 0 ? history : null,
    emptyMessage: `No analysis run of this group in the last ${days} days. Run an analysis or choose a longer period.`,
  });
}

/**
 * The per-hotel report: headline KPIs for one run, their evolution, what
 * drove the latest change, and every keyword's runs, over a chosen period.
 */
export function GroupKpiReport({
  scope, scopeLabel, history, loading, error, days, onDaysChange
}: Props) {
  const periodId = useId();
  const [runTimestamp, setRunTimestamp] = useState<string | null>(null);
  const [keyword, setKeyword] = useState<string | null>(null);
  const [includePartial, setIncludePartial] = useState(false);

  const gate = gateGroupHistory({
    title: 'Headline',
    history,
    loading,
    error,
    days,
  });

  const periodPicker = (
    <div className="print-hidden">
      <label htmlFor={periodId} className="mr-2 text-xs text-gray-600 dark:text-gray-300">Period</label>
      <select
        id={periodId}
        value={days}
        onChange={(event) => onDaysChange(Number(event.target.value))}
        className="rounded-lg border border-gray-200 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
      >
        {GROUP_REPORT_PERIODS.map((period) => <option key={period} value={period}>{`Last ${period} days`}</option>)}
      </select>
    </div>
  );

  if (!gate.ready) {
    return (
      <>
        <div className="mb-4">{periodPicker}</div>
        {gate.placeholder}
        <KpiDefinitionsSection definitions={GROUP_REPORT_DEFINITIONS} />
      </>
    );
  }

  const {
    runs, keywords, keywords_truncated: truncated, group_run_min_coverage: minCoverage,
    citations_configured: citationsConfigured
  } = gate.value;
  const run = resolveRun(runs, runTimestamp);
  const selectedKeyword = resolveKeyword(keywords, keyword);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        {periodPicker}
        <GroupKpiExportButton scope={scope} scopeLabel={scopeLabel} history={gate.value} run={run} />
      </div>
      {truncated && (
        <p role="note" className="mb-4 text-xs text-amber-700 dark:text-amber-400">
          {`This group has more keywords than one report covers; only the first ${keywords.length} are included.`}
        </p>
      )}
      <HistoryCutNote history={gate.value} />
      <GroupKpiHeadlineSection runs={runs} selected={run} onSelect={setRunTimestamp} citationsConfigured={citationsConfigured} />
      <GroupKpiTrendSection
        runs={runs}
        minCoverage={minCoverage}
        includePartial={includePartial}
        onIncludePartialChange={setIncludePartial}
      />
      <GroupKpiDriversSection scope={scope} run={run} />
      {selectedKeyword !== null && (
        <KeywordRunsSection scope={scope} days={days} keywords={keywords} selected={selectedKeyword} onSelect={setKeyword} />
      )}
      <KpiDefinitionsSection definitions={GROUP_REPORT_DEFINITIONS} />
    </>
  );
}
