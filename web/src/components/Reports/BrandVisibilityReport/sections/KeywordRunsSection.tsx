import { useId } from 'react';
import type {
  KeywordRun, KeywordRunSummary
} from '../../../../types/domain/groupKpiHistory';
import type { ReportScope } from '../../../../types';
import { useKeywordRuns } from '../../../../hooks/useGroupKpiDetail';
import { formatDate } from '../../../../formatting/dateFormatter';
import {
  formatKpi, formatKpiDelta
} from '../../../../formatting/kpiFormatter';
import type { KpiId } from '../../../../constants/kpiDefinitions';
import {
  kpiColumn, ReportSection, ReportTable, type ReportTableColumn
} from '../../layout';

interface Props {
  /** The group the keywords belong to and the period: the selected keyword's runs are read on demand. */
  readonly scope: ReportScope;
  readonly days: number;
  readonly keywords: readonly KeywordRunSummary[];
  readonly selected: KeywordRunSummary;
  readonly onSelect: (keyword: string) => void;
}

const NOTE_CLASS = 'text-sm text-gray-500 dark:text-gray-400';

function mentionCell(run: KeywordRun): string {
  const mentioned = (run.kpis.mentions ?? 0) > 0 ? 'Yes' : 'No';
  if (run.change?.mention === 'gained') return `${mentioned} (new)`;
  if (run.change?.mention === 'lost') return `${mentioned} (lost)`;
  return mentioned;
}

/** The KPI value, followed by its change since the keyword's previous run when there is one. */
function valueWithChange(run: KeywordRun, id: KpiId): string {
  const value = formatKpi(id, run.kpis[id]);
  const change = run.change?.deltas[id];
  return change === null || change === undefined ? value : `${value} (${formatKpiDelta(id, change)})`;
}

function changingColumn(id: KpiId): ReportTableColumn<KeywordRun> {
  return kpiColumn(id, (run) => valueWithChange(run, id));
}

/** Built per render (not at import) so every column is exercised by the tests that render the table. */
function runColumns(): ReadonlyArray<ReportTableColumn<KeywordRun>> {
  return [
    {
      header: 'Run',
      // Stryker disable next-line StringLiteral: Tailwind-only cell styling
      cellClassName: 'whitespace-nowrap',
      render: (run) => formatDate(run.timestamp),
    },
    {
      header: 'Brand mentioned',
      info: 'Whether any answer of this run names your brand; "new" and "lost" compare with the keyword\'s previous run.',
      render: mentionCell,
    },
    kpiColumn('mentions', (run) => `${formatKpi('mentions', run.kpis.mentions)} of ${formatKpi('answers', run.kpis.answers)}`, 'Answers mentioning'),
    changingColumn('mention_rate'),
    changingColumn('share_of_voice'),
    changingColumn('average_position'),
    changingColumn('top_1_share'),
    changingColumn('visibility_score'),
    changingColumn('citation_rate'),
    kpiColumn('net_sentiment', (run) => formatKpi('net_sentiment', run.kpis.net_sentiment)),
  ];
}

interface RunsTableProps {
  readonly scope: ReportScope;
  readonly days: number;
  readonly keyword: string;
}

/** The runs of one keyword, newest first, read when it is shown. */
function RunsTable({
  scope, days, keyword
}: RunsTableProps) {
  const {
    history, loading, error
  } = useKeywordRuns(scope, days, keyword);
  if (error !== null) {
    return <p role="alert" className="text-sm text-red-700">{`Could not load this keyword's runs: ${error}`}</p>;
  }
  if (loading || history === null) {
    return <p className={NOTE_CLASS}>Loading this keyword&apos;s runs…</p>;
  }
  const runs = [...history.runs].reverse();
  return (
    <>
      {/* Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical */}
      <ReportTable columns={runColumns()} rows={runs} rowKey={(run) => run.timestamp} />
      {history.runs_truncated === true && (
        <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">Older runs are left out; export to Excel for the newest runs of every keyword.</p>
      )}
    </>
  );
}

/**
 * Every run of one keyword, newest first, with its change since that
 * keyword's previous run — to see which keywords move the group's KPIs.
 */
export function KeywordRunsSection({
  scope, days, keywords, selected, onSelect
}: Props) {
  const pickerId = useId();

  return (
    <ReportSection title="Keyword detail" subtitle="Every analysis run of one keyword, newest first, with its change since that keyword's previous run.">
      <div className="mb-3 print-hidden">
        <label htmlFor={pickerId} className="mr-2 text-xs text-gray-600 dark:text-gray-300">Keyword</label>
        <select
          id={pickerId}
          value={selected.keyword}
          onChange={(event) => onSelect(event.target.value)}
          className="rounded-lg border border-gray-200 p-1 text-xs dark:border-gray-700 dark:bg-gray-800"
        >
          {keywords.map((entry) => (
            <option key={entry.keyword} value={entry.keyword}>{`${entry.keyword} (${entry.runs_count} runs)`}</option>
          ))}
        </select>
      </div>
      {selected.runs_count === 0 ? (
        <p className={NOTE_CLASS}>No analysis run of this keyword in the selected period.</p>
      ) : (
        <RunsTable scope={scope} days={days} keyword={selected.keyword} />
      )}
    </ReportSection>
  );
}
