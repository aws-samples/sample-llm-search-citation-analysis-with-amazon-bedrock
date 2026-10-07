import {
  EMPTY_KPI, formatKpi
} from '../../../formatting/kpiFormatter';
import type {
  CompetitorCaveatRow, ReportInsightsResponse
} from '../../../types/domain/insights';
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

/** Built per response: a competitor carrying a competitor-caveat insight is marked. */
function caveatColumns({ insights }: ReportInsightsResponse): ReadonlyArray<ReportTableColumn<CompetitorCaveatRow>> {
  const flagged = new Set(insights.filter((insight) => insight.kind === 'competitor_caveat').map((insight) => insight.subject));
  return [
    {
      header: 'Competitor',
      render: (row) => <MarkedName name={row.name} marker="Caveat" tone="watch" marked={flagged.has(row.name)} />,
    },
    {
      header: 'Mentions',
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
      info: 'Up to three reasons the answers give for the mixed or negative wording.',
      render: (row) => <Reasons reasons={row.reasons} />,
    },
  ];
}

/** Per competitor, how often the AI engines word it mixed or negative, and why. */
export function CompetitorCaveatsSection(slice: InsightsSectionProps) {
  return (
    <InsightsTableSection
      title={COMPETITOR_CAVEATS_TITLE}
      subtitle="What the AI engines criticise about your competitors in the latest runs: their mixed and negative mentions and the reasons given."
      block="insights_competitor_caveats"
      slice={slice}
      rows={({ facts }) => facts.competitor_caveats}
      columns={caveatColumns}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(row) => row.name}
      emptyMessage={CAVEATS_EMPTY}
    />
  );
}
