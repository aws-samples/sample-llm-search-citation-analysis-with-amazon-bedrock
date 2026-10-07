import type { ReactNode } from 'react';
import type {
  Insight, InsightBlock, ReportInsightsResponse
} from '../../../types/domain/insights';
import {
  gateSection, ReportSection, ReportTable, SectionPlaceholder, type ReportSlice, type ReportTableColumn
} from '../layout';
import { insightSentence } from './insightWording';

/** A section's `/reports/insights` slice: the props every insights block section takes. */
export type InsightsSectionProps = ReportSlice<ReportInsightsResponse>;

interface Props<Row> {
  readonly title: string;
  readonly subtitle: string;
  /** The block whose insights are read out above the table. */
  readonly block: InsightBlock;
  readonly slice: InsightsSectionProps;
  /** The rows the block tables; none shows `emptyMessage`. */
  readonly rows: (response: ReportInsightsResponse) => readonly Row[];
  readonly columns: (response: ReportInsightsResponse) => ReadonlyArray<ReportTableColumn<Row>>;
  readonly rowKey: (row: Row) => string;
  /** Why the table is empty; a function when the reason depends on the response. */
  readonly emptyMessage: string | ((response: ReportInsightsResponse) => string);
  /** A sentence under the table or the empty message: what was left out, or how to measure more. */
  readonly note?: (response: ReportInsightsResponse) => ReactNode;
}

/** The loading and error placeholders of an insights section titled `title`, or its loaded response. */
export function gateInsights(title: string, slice: InsightsSectionProps) {
  return gateSection({
    title,
    loading: slice.loading,
    loadingMessage: 'Loading insights…',
    error: slice.error,
    value: slice.data,
  });
}

function InsightLines({ insights }: { readonly insights: readonly Insight[] }) {
  if (insights.length === 0) return null;
  return (
    <ul className="mb-3 list-disc space-y-1 pl-5 text-sm text-gray-800 dark:text-gray-200">
      {insights.map((insight) => <li key={insight.id}>{insightSentence(insight)}</li>)}
    </ul>
  );
}

/**
 * An insights block: its loading and error placeholders, then the sentence of
 * every insight pointing at the block over the table of the facts behind
 * them, or why the table is empty.
 */
export function InsightsTableSection<Row>({
  title, subtitle, block, slice, rows, columns, rowKey, emptyMessage, note
}: Props<Row>) {
  const gate = gateInsights(title, slice);
  if (!gate.ready) return gate.placeholder;

  const response = gate.value;
  const tabled = rows(response);
  const footnote = note?.(response);
  return (
    <ReportSection title={title} subtitle={subtitle}>
      <InsightLines insights={response.insights.filter((insight) => insight.block === block)} />
      {tabled.length === 0
        ? <SectionPlaceholder variant="empty" message={typeof emptyMessage === 'string' ? emptyMessage : emptyMessage(response)} />
        : <ReportTable columns={columns(response)} rows={tabled} rowKey={rowKey} />}
      {footnote && <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">{footnote}</p>}
    </ReportSection>
  );
}
