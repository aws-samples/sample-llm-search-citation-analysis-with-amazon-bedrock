import { providerName } from '../../../constants/providers';
import {
  EMPTY_KPI, formatKpi
} from '../../../formatting/kpiFormatter';
import type {
  PromptEngineRow, ReportInsightsResponse
} from '../../../types/domain/insights';
import {
  kpiColumn, type ReportTableColumn
} from '../layout';
import {
  InsightsTableSection, type InsightsSectionProps
} from './InsightsTableSection';

export const PROMPT_ENGINE_TITLE = 'Prompts by engine';

/** What the section says while no keyword has an answer. */
export const PROMPT_ENGINE_EMPTY = 'No AI engine answered a keyword of this scope yet.';

/** What a cell says when the engine answered without naming your brand at a known position. */
export const NOT_NAMED = 'Not named';

/** Spoken after a lost cell, so the highlight is not carried by colour alone. */
const LOST_LABEL = ', below the top 3';

interface CellProps {
  readonly row: PromptEngineRow;
  readonly engine: string;
}

/** One keyword on one engine: its best position, "Not named", or a dash when the engine did not answer; lost cells highlighted. */
function PositionCell({
  row, engine
}: CellProps) {
  if (!(engine in row.positions)) {
    return (
      <>
        <span aria-hidden="true">{EMPTY_KPI}</span>
        <span className="sr-only">Not answered</span>
      </>
    );
  }
  const position = row.positions[engine];
  const text = position === null ? NOT_NAMED : String(position);
  if (!row.lost_engines.includes(engine)) return <span>{text}</span>;
  return (
    <span className="inline-block rounded bg-red-50 px-1.5 py-0.5 font-semibold text-red-700">
      {text}
      <span className="sr-only">{LOST_LABEL}</span>
    </span>
  );
}

/** Built per response: one column per engine that answered. */
function promptColumns({ facts }: ReportInsightsResponse): ReadonlyArray<ReportTableColumn<PromptEngineRow>> {
  return [
    {
      header: 'Keyword',
      // Stryker disable next-line StringLiteral: Tailwind-only cell styling
      cellClassName: 'font-medium',
      render: (row) => row.keyword,
    },
    kpiColumn('visibility_score', (row) => formatKpi('visibility_score', row.visibility_score)),
    ...facts.prompt_engine.engines.map((engine): ReportTableColumn<PromptEngineRow> => ({
      header: providerName(engine),
      render: (row) => <PositionCell row={row} engine={engine} />,
    })),
  ];
}

/** How many keywords the 50-row cap left out, if any. */
function omittedNote({ facts }: ReportInsightsResponse): string | null {
  const { omitted } = facts.prompt_engine;
  if (omitted === 0) return null;
  return `${omitted} more keyword${omitted === 1 ? '' : 's'} with a higher visibility score ${omitted === 1 ? 'is' : 'are'} not shown.`;
}

/** Your brand's best position per keyword and AI engine, the weakest keywords first, the cells below the top 3 highlighted. */
export function PromptEngineSection(slice: InsightsSectionProps) {
  return (
    <InsightsTableSection
      title={PROMPT_ENGINE_TITLE}
      subtitle={`Your brand's best position in each keyword's latest run, per AI engine; highlighted when below the top 3 or not named. A dash: the engine did not answer.`}
      block="insights_prompt_engine"
      slice={slice}
      rows={({ facts }) => facts.prompt_engine.keywords}
      columns={promptColumns}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(row) => row.keyword}
      emptyMessage={PROMPT_ENGINE_EMPTY}
      note={omittedNote}
    />
  );
}
