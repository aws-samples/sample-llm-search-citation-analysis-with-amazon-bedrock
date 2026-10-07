import { formatKpi } from '../../../formatting/kpiFormatter';
import type {
  KeywordStabilityRow, ReportInsightsResponse
} from '../../../types/domain/insights';
import type { ReportTableColumn } from '../layout';
import { MarkedName } from './InsightChip';
import {
  InsightsTableSection, type InsightsSectionProps
} from './InsightsTableSection';

export const RUN_STABILITY_TITLE = 'Run stability';

/** What the block says while no keyword of the group has a second run to compare with. */
export const STABILITY_EMPTY = 'Stability needs a second run of this group';

/** A position, worded like the average position KPI it is taken from. */
function position(value: number): string {
  return formatKpi('average_position', value);
}

const STABILITY_COLUMNS: ReadonlyArray<ReportTableColumn<KeywordStabilityRow>> = [
  {
    header: 'Keyword',
    render: (row) => <MarkedName name={row.keyword} marker="Unstable" tone="watch" marked={row.unstable} />,
  },
  {
    header: 'Runs',
    info: 'The runs of the period in which an answer placed your brand.',
    render: (row) => String(row.runs),
  },
  {
    header: 'Best position',
    info: 'The lowest average position over those runs.',
    render: (row) => position(row.position_min),
  },
  {
    header: 'Worst position',
    info: 'The highest average position over those runs.',
    render: (row) => position(row.position_max),
  },
  {
    header: 'Position range',
    info: 'Worst minus best position; 3 places or more marks the keyword unstable.',
    render: (row) => position(row.position_range),
  },
  {
    header: 'Mention flips',
    info: 'The runs in which your brand\'s mention was gained or lost since the previous run; one or more marks the keyword unstable.',
    render: (row) => String(row.flips),
  },
];

/** Every keyword once one of them has a second run to compare with; nothing to compare before. */
function comparableRows({ facts }: ReportInsightsResponse): readonly KeywordStabilityRow[] {
  return facts.stability.some((row) => row.runs >= 2) ? facts.stability : [];
}

/** How far each keyword of the group swings between runs, the swinging ones marked unstable. */
export function RunStabilitySection(slice: InsightsSectionProps) {
  return (
    <InsightsTableSection
      title={RUN_STABILITY_TITLE}
      subtitle="How far each keyword's average position swings between the runs of the period, and how often your brand's mention came and went."
      block="insights_run_stability"
      slice={slice}
      rows={comparableRows}
      columns={() => STABILITY_COLUMNS}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(row) => row.keyword}
      emptyMessage={STABILITY_EMPTY}
    />
  );
}
