import { useId } from 'react';
import type {
  KeywordRun, KeywordRunHistory
} from '../../../../types/domain/groupKpiHistory';
import { formatDate } from '../../../../formatting/dateFormatter';
import {
  ReportSection, ReportTable, type ReportTableColumn
} from '../../layout';
import {
  formatPercent, formatPointsDelta, formatRank
} from '../groupKpiView';

interface Props {
  readonly keywords: readonly KeywordRunHistory[];
  readonly selected: KeywordRunHistory;
  readonly onSelect: (keyword: string) => void;
}

function mentionCell(run: KeywordRun): string {
  const mentioned = run.first_party_mentioned ? 'Yes' : 'No';
  if (run.change?.mention === 'gained') return `${mentioned} (new)`;
  if (run.change?.mention === 'lost') return `${mentioned} (lost)`;
  return mentioned;
}

function withChange(value: string, change: number | null | undefined): string {
  return change === null || change === undefined ? value : `${value} (${formatPointsDelta(change)})`;
}

const RUN_COLUMNS: ReadonlyArray<ReportTableColumn<KeywordRun>> = [
  {
    header: 'Run',
    // Stryker disable next-line StringLiteral: Tailwind-only cell styling
    cellClassName: 'whitespace-nowrap',
    render: (run) => formatDate(run.timestamp),
  },
  {
    header: 'Hotel mentioned',
    render: mentionCell,
  },
  {
    header: 'Share of voice',
    render: (run) => withChange(formatPercent(run.first_party_sov), run.change?.first_party_sov),
  },
  {
    header: 'Rank #1 share',
    render: (run) => withChange(formatPercent(run.rank_1_share), run.change?.rank_1_share),
  },
  {
    header: 'Top-3 share',
    render: (run) => withChange(formatPercent(run.top_3_share), run.change?.top_3_share),
  },
  {
    header: 'Mean rank',
    render: (run) => formatRank(run.mean_rank),
  },
  {
    header: 'Best rank',
    render: (run) => (run.first_party_best_rank === null ? '—' : `#${run.first_party_best_rank}`),
  },
  {
    header: 'Answers mentioning',
    render: (run) => `${run.mentioned_answers} of ${run.answers}`,
  },
];

/**
 * Every run of one keyword, newest first, with its change since that
 * keyword's previous run — to see which keywords move the hotel's KPIs.
 */
export function KeywordRunsSection({
  keywords, selected, onSelect
}: Props) {
  const pickerId = useId();
  const runs = [...selected.runs].reverse();

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
            <option key={entry.keyword} value={entry.keyword}>{`${entry.keyword} (${entry.runs.length} runs)`}</option>
          ))}
        </select>
      </div>
      {runs.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">No analysis run of this keyword in the selected period.</p>
      ) : (
        // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
        <ReportTable columns={RUN_COLUMNS} rows={runs} rowKey={(run) => run.timestamp} />
      )}
    </ReportSection>
  );
}
