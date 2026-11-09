import {
  EMPTY_KPI, formatKpi
} from '../../../formatting/kpiFormatter';
import type {
  CaveatReason, CompetitorCaveatRow, ReportInsightsResponse
} from '../../../types/domain/insights';
import type { ListPaging } from '../../../api/scopedListPages';
import {
  useScopedList, type ScopedList
} from '../../../hooks/useScopedList';
import { isCaveatReason } from '../../../types/domain/insightFactDecoders';
import { LoadMoreButton } from '../../ui/LoadMoreButton';
import type { ReportTableColumn } from '../layout';
import {
  InsightsTableSection, type InsightsSectionProps
} from './InsightsTableSection';
import { MarkedName } from './InsightChip';

export const COMPETITOR_CAVEATS_TITLE = 'Competitor caveats';

/** What the section says while no answer names a competitor. */
export const CAVEATS_EMPTY = 'No answer of the latest runs names a competitor yet.';

function Reasons({ reasons }: { readonly reasons: readonly string[] }) {
  if (reasons.length === 0) return <>{EMPTY_KPI}</>;
  return (
    <ul className="list-disc space-y-0.5 pl-4">
      {reasons.map((reason) => <li key={reason}>{reason}</li>)}
    </ul>
  );
}

/** Every caveat reason (2.45.0 wave 5): an answer lists none, `view=caveat_reasons` pages them all. */
const CAVEAT_REASONS_PAGING: ListPaging = {
  list: 'facts.caveat_reasons.reasons',
  token: 'facts.caveat_reasons.reasons_next_token',
  total: 'facts.caveat_reasons.reasons_total',
  view: 'caveat_reasons',
};

/** The row's first reasons, then each loaded reason of the competitor not among them, in answer order. */
function rowReasons(row: CompetitorCaveatRow, loaded: readonly CaveatReason[]): string[] {
  const reasons = [...row.reasons];
  loaded.forEach(({
    competitor, reason
  }) => {
    if (competitor === row.name && !reasons.includes(reason)) reasons.push(reason);
  });
  return reasons;
}

/** How many reasons the rows list beyond what is on screen. */
function hiddenReasons(rows: readonly CompetitorCaveatRow[], loaded: readonly CaveatReason[]): number {
  return rows.reduce((hidden, row) => hidden + Math.max(0, (row.reasons_total ?? row.reasons.length) - rowReasons(row, loaded).length), 0);
}

/** Under the table while reasons are left out: how many, the button that loads them, and a page error. */
function CaveatReasonsFooter({
  rows, list
}: {
  readonly rows: readonly CompetitorCaveatRow[];
  readonly list: ScopedList<CaveatReason>
}) {
  const hidden = hiddenReasons(rows, list.items);
  if (hidden === 0 && list.error === null) return null;
  return (
    <div className="print-hidden mt-3 space-y-2">
      {hidden > 0 && <p className="text-xs text-gray-500">{hidden === 1 ? '1 more reason is not shown.' : `${hidden} more reasons are not shown.`}</p>}
      {list.error !== null && <p role="alert" className="text-xs text-red-700">{list.error}</p>}
      <LoadMoreButton onLoadMore={hidden > 0 ? list.loadMore : undefined} loading={list.loadingMore} label="Load more reasons" />
    </div>
  );
}

/** Built per response: a competitor carrying a competitor-caveat insight is marked; `loaded` adds the paged reasons. */
function caveatColumns({ insights }: ReportInsightsResponse, loaded: readonly CaveatReason[]): ReadonlyArray<ReportTableColumn<CompetitorCaveatRow>> {
  const flagged = new Set(insights.filter((insight) => insight.kind === 'competitor_caveat').map((insight) => insight.subject));
  return [
    {
      header: 'Competitor',
      render: (row) => <MarkedName name={row.name} marker="Caveat" tone="watch" marked={flagged.has(row.name)} />,
    },
    {
      header: 'Mentions',
      numeric: true,
      info: 'Answers of the latest runs naming the competitor.',
      render: (row) => String(row.mentions),
    },
    {
      header: 'Mixed',
      render: (row) => String(row.mixed),
    },
    {
      header: 'Negative',
      render: (row) => String(row.negative),
    },
    {
      header: 'Caveat share',
      info: 'Mixed and negative mentions out of all its mentions; 30% or more over 5 mentions or more marks a caveat.',
      render: (row) => formatKpi('mention_rate', row.caveat_share),
    },
    {
      header: 'Reasons',
      info: 'The reasons the answers give for the mixed or negative wording: the first three, then every reason "Load more reasons" reads.',
      render: (row) => <Reasons reasons={rowReasons(row, loaded)} />,
    },
  ];
}

/** Per competitor, how often the AI engines word it mixed or negative, and why. */
export function CompetitorCaveatsSection(slice: InsightsSectionProps) {
  const reasons = useScopedList(slice.data, slice.request ?? null, CAVEAT_REASONS_PAGING, isCaveatReason);
  return (
    <InsightsTableSection
      title={COMPETITOR_CAVEATS_TITLE}
      subtitle="What the AI engines criticise about your competitors in the latest runs: their mixed and negative mentions and the reasons given."
      block="insights_competitor_caveats"
      slice={slice}
      rows={({ facts }) => facts.competitor_caveats}
      columns={(response) => caveatColumns(response, reasons.items)}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(row) => row.name}
      emptyMessage={CAVEATS_EMPTY}
      footer={slice.data !== null && <CaveatReasonsFooter rows={slice.data.facts.competitor_caveats} list={reasons} />}
    />
  );
}
