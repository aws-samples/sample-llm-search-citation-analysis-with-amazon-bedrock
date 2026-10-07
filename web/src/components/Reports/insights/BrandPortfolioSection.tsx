import { formatKpi } from '../../../formatting/kpiFormatter';
import type { PortfolioBrandRow } from '../../../types/domain/insights';
import {
  kpiColumn, type ReportTableColumn
} from '../layout';
import { MarkedName } from './InsightChip';
import {
  InsightsTableSection, type InsightsSectionProps
} from './InsightsTableSection';
import { formatGap } from './insightWording';

export const BRAND_PORTFOLIO_TITLE = 'Brand portfolio';

/** What the portfolio says when fewer than two of your brands are named often enough to compare. */
export const PORTFOLIO_EMPTY = 'Needs at least two tracked brands with 3 or more mentions';

const PORTFOLIO_COLUMNS: ReadonlyArray<ReportTableColumn<PortfolioBrandRow>> = [
  {
    header: 'Brand',
    render: (row) => <MarkedName name={row.name} marker="Weak" tone="bad" marked={row.weak} />,
  },
  kpiColumn('mentions', (row) => formatKpi('mentions', row.mentions)),
  kpiColumn('average_position', (row) => formatKpi('average_position', row.average_position)),
  kpiColumn('net_sentiment', (row) => formatKpi('net_sentiment', row.net_sentiment)),
  kpiColumn('citations', (row) => formatKpi('citations', row.citations)),
  {
    header: 'Position gap',
    info: 'Places behind the best-placed of your brands; 2 or more marks the brand weak.',
    render: (row) => formatGap(row.position_gap, 2),
  },
  {
    header: 'Sentiment gap',
    info: 'Points behind the best net sentiment of your brands; 30 or more marks the brand weak.',
    render: (row) => formatGap(row.sentiment_gap, 1),
  },
];

/** Your brands named in three answers or more, each against the best of them, the trailing ones marked weak. */
export function BrandPortfolioSection(slice: InsightsSectionProps) {
  return (
    <InsightsTableSection
      title={BRAND_PORTFOLIO_TITLE}
      subtitle="Your brands named in three answers or more of the latest runs, each against the best-placed and best-worded of them."
      block="insights_brand_portfolio"
      slice={slice}
      rows={({ facts }) => facts.portfolio}
      columns={() => PORTFOLIO_COLUMNS}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(row) => row.name}
      emptyMessage={PORTFOLIO_EMPTY}
    />
  );
}
