import { useState } from 'react';
import type {
  ReportScope, VisibilityResponse
} from '../../../types';
import type { SentimentSplit } from '../../../types/domain/groupKpiHistory';
import type { SentimentLabel } from '../../../types/domain/sentimentExamples';
import { Button } from '../../ui';
import {
  ReportTable, type ReportTableColumn
} from '../layout/ReportTable';
import { emphasisColumn } from '../layout/kpiColumn';
import { SENTIMENTS } from '../charts/sentimentSplitChartConfiguration';
import {
  engineLabel, SentimentExamplesModal
} from './SentimentExamplesModal';

/** One row of counts: every engine together (`provider` null) or one engine. */
interface CountRow {
  readonly provider: string | null;
  readonly label: string;
  readonly split: SentimentSplit;
}

interface Selection {
  readonly provider: string | null;
  readonly sentiment: SentimentLabel;
}

type SelectCount = (selection: Selection) => void;

function countRows(visibility: VisibilityResponse): CountRow[] {
  const all: CountRow = {
    provider: null,
    label: engineLabel(null),
    split: visibility.kpis.sentiment_split,
  };
  return [all, ...visibility.engines.map((engine) => ({
    provider: engine.engine,
    label: engineLabel(engine.engine),
    split: engine.kpis.sentiment_split,
  }))];
}

/** "Show the 3 negative answers from OpenAI", "Show the 1 positive answer from all engines". */
function countButtonName(count: number, sentiment: SentimentLabel, row: CountRow): string {
  const answers = count === 1 ? 'answer' : 'answers';
  const from = row.provider === null ? 'all engines' : row.label;
  return `Show the ${count} ${sentiment} ${answers} from ${from}`;
}

function CountCell({
  row, sentiment, onSelect
}: {
  readonly row: CountRow;
  readonly sentiment: SentimentLabel;
  readonly onSelect: SelectCount;
}) {
  const count = row.split[sentiment];
  if (count === 0) return <span className="text-gray-400">0</span>;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3 tabular-nums underline decoration-dotted underline-offset-4"
      aria-label={countButtonName(count, sentiment, row)}
      onClick={() => onSelect({
        provider: row.provider,
        sentiment,
      })}
    >
      {count}
    </Button>
  );
}

function countColumns(onSelect: SelectCount): Array<ReportTableColumn<CountRow>> {
  return [
    emphasisColumn('AI engine', (row) => row.label),
    ...SENTIMENTS.map(({
      key, label
    }): ReportTableColumn<CountRow> => ({
      header: label,
      render: (row) => <CountCell row={row} sentiment={key} onSelect={onSelect} />,
    })),
  ];
}

interface Props {
  readonly scope: ReportScope;
  readonly visibility: VisibilityResponse;
}

/**
 * The counts of the sentiment split per engine, each opening the answers
 * behind it. The counts are buttons on screen and plain figures on paper.
 */
export function SentimentCountTable({
  scope, visibility
}: Props) {
  const [selection, setSelection] = useState<Selection | null>(null);

  return (
    <div className="mt-6">
      <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Answers per AI engine and sentiment</h3>
      <p className="mt-1 mb-3 text-xs text-gray-500 dark:text-gray-400 print-hidden">
        Select a count to read the answers behind it: the passage about your brand, why it was labelled so and the full answer.
      </p>
      <ReportTable
        columns={countColumns(setSelection)}
        rows={countRows(visibility)}
        // Stryker disable next-line ArrowFunction,LogicalOperator,StringLiteral: React row key only; the rendered rows are identical
        rowKey={(row) => row.provider ?? 'all'}
      />
      {selection !== null && (
        <SentimentExamplesModal
          scope={scope}
          scopeLabel={visibility.scope.label}
          sentiment={selection.sentiment}
          provider={selection.provider}
          onClose={() => setSelection(null)}
        />
      )}
    </div>
  );
}
