import {
  useId, useState
} from 'react';
import {
  isKeywordRunSummary, type GroupKpiHistoryResponse, type GroupRun, type KeywordRunSummary
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
import { ExportAllButton } from '../../ui/ExportAllButton';
import { reportScopeParams } from '../../ui/reportScope';
import { useSelectedMarketId } from '../../Markets/marketSelectionContext';
import { GROUP_REPORT_DEFINITIONS } from '../../../constants/kpiDefinitions';
import { formatDate } from '../../../formatting/dateFormatter';
import {
  ReportCutNote, runsAfter
} from '../layout/HistoryCutNote';
import { ScopeCoverageNote } from '../../ui/ScopeCoverageNote';
import { ScopedListFooter } from '../../ui/ScopedListFooter';
import { useScopedList } from '../../../hooks/useScopedList';
import { GROUP_KPI_KEYWORDS_PAGING } from '../../../api/scopedListPagings';
import type { ListRequest } from '../../../api/scopedListPages';
import {
  useEveryGroupRun, type EveryGroupRun
} from '../../../hooks/useEveryGroupRun';

/** The periods the report offers, in days. */
const GROUP_REPORT_PERIODS = [30, 90, 180, 365] as const;

interface HistoryGateOptions extends SectionFetchState {
  readonly title: string;
  readonly history: GroupKpiHistoryResponse | null;
  readonly days: number;
}

interface Props extends Omit<HistoryGateOptions, 'title'> {
  /** The keyword group the report covers. */
  readonly scope: ReportScope;
  readonly onDaysChange: (days: number) => void;
  /** The request `history` answered: the keyword list loads its next pages with it (2.45.0). */
  readonly request?: ListRequest | null;
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
  if (history.truncated_before !== null) return runsAfter(history.truncated_before);
  const oldestShown = history.runs_truncated ? history.runs[0]?.timestamp : undefined;
  return oldestShown === undefined ? null : `from ${formatDate(oldestShown)} on`;
}

/** Why the report starts later than the period: the period holds more data than one report reads. */
export function HistoryCutNote({ history }: { readonly history: GroupKpiHistoryResponse }) {
  const covers = coveredRuns(history);
  if (covers === null) return null;
  return <ReportCutNote covers={covers} />;
}

/** The summary with every run of the window once `view=runs` read them all (2.45.0 wave 5). */
function withEveryRun(history: GroupKpiHistoryResponse, everyRun: EveryGroupRun): GroupKpiHistoryResponse {
  if (everyRun.runs === null) return history;
  return {
    ...history,
    runs: [...everyRun.runs],
    runs_truncated: false,
  };
}

/** While the older runs of a cut summary load, or why they could not. */
function EveryRunNote({
  history, everyRun
}: {
  readonly history: GroupKpiHistoryResponse;
  readonly everyRun: EveryGroupRun 
}) {
  if (everyRun.error !== null) {
    return <p role="alert" className="mb-4 text-xs text-red-700">{`The older runs could not be loaded: ${everyRun.error}`}</p>;
  }
  if (!everyRun.loading) return null;
  const total = history.runs_total ?? history.runs.length;
  return <output className="print-hidden mb-4 block text-xs text-gray-500">{`Loading all ${total} runs of the period…`}</output>;
}

/** A group section's loading, error and "no run in the period" states; ready once the group has a run. */
export function gateGroupHistory({
  title, history, loading, error, days, computing
}: HistoryGateOptions): SectionGate<GroupKpiHistoryResponse> {
  return gateSection({
    title,
    loading,
    computing,
    loadingMessage: 'Loading the group KPI history…',
    loadingShape: 'stats',
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
  scope, history, request = null, loading, error, computing, days, onDaysChange
}: Props) {
  const periodId = useId();
  const marketId = useSelectedMarketId();
  const [runTimestamp, setRunTimestamp] = useState<string | null>(null);
  const [keyword, setKeyword] = useState<string | null>(null);
  const [includePartial, setIncludePartial] = useState(false);
  const keywordList = useScopedList(history, request, GROUP_KPI_KEYWORDS_PAGING, isKeywordRunSummary);
  const everyRun = useEveryGroupRun(history, request);

  const gate = gateGroupHistory({
    title: 'Headline',
    history,
    loading,
    error,
    computing,
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

  const shown = withEveryRun(gate.value, everyRun);
  const {
    runs, group_run_min_coverage: minCoverage, citations_configured: citationsConfigured
  } = shown;
  const keywords = keywordList.items;
  const run = resolveRun(runs, runTimestamp);
  const selectedKeyword = resolveKeyword(keywords, keyword);

  return (
    <>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        {periodPicker}
        <ExportAllButton view="group-kpis" params={{
          ...reportScopeParams(scope, marketId),
          days,
        }} />
      </div>
      <ScopeCoverageNote response={shown} className="mb-4" />
      <EveryRunNote history={gate.value} everyRun={everyRun} />
      <HistoryCutNote history={shown} />
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
      <ScopedListFooter list={keywordList} noun="keywords" />
      <KpiDefinitionsSection definitions={GROUP_REPORT_DEFINITIONS} />
    </>
  );
}
