import type { KpiId } from '../../../constants/kpiDefinitions';
import { providerName } from '../../../constants/providers';
import { formatKpi } from '../../../formatting/kpiFormatter';
import type {
  EnginePlay, EnginePlayRow, ReportInsightsResponse
} from '../../../types/domain/insights';
import {
  kpiColumn, type ReportTableColumn
} from '../layout';
import {
  InsightChip, type ChipTone
} from './InsightChip';
import {
  InsightsTableSection, type InsightsSectionProps
} from './InsightsTableSection';
import {
  PLAY_INFO, PLAY_LABELS
} from './insightWording';

export const ENGINE_PLAYBOOK_TITLE = 'Engine playbook';

/** The KPIs the play is read from, then the sentiment the engine words the brand with. */
const ENGINE_KPI_IDS: readonly KpiId[] = ['top_1_share', 'top_3_share', 'citation_rate', 'net_sentiment'];

const PLAY_TONES: Readonly<Record<EnginePlay, ChipTone>> = {
  get_cited: 'watch',
  get_ranked_first: 'watch',
  get_mentioned_and_cited: 'bad',
  defend: 'good',
};

/** Built per response: the citation rate column is left out while no owned domain is configured. */
function engineColumns({ citations_configured: citationsConfigured }: ReportInsightsResponse): ReadonlyArray<ReportTableColumn<EnginePlayRow>> {
  const kpiIds = ENGINE_KPI_IDS.filter((id) => citationsConfigured || id !== 'citation_rate');
  return [
    {
      header: 'AI engine',
      // Stryker disable next-line StringLiteral: Tailwind-only cell styling
      cellClassName: 'font-medium whitespace-nowrap',
      render: (row) => providerName(row.engine),
    },
    ...kpiIds.map((id) => kpiColumn<EnginePlayRow>(id, (row) => formatKpi(id, row.kpis[id]))),
    {
      header: 'Play',
      info: PLAY_INFO,
      render: (row) => <InsightChip label={PLAY_LABELS[row.play]} tone={PLAY_TONES[row.play]} />,
    },
  ];
}

/** One row per AI engine of the latest runs: the shares its play is read from, its sentiment, and the play. */
export function EnginePlaybookSection(slice: InsightsSectionProps) {
  return (
    <InsightsTableSection
      title={ENGINE_PLAYBOOK_TITLE}
      subtitle="What to do about each AI engine, from how often its answers rank your brand first and how often they link to one of your domains."
      block="insights_engine_playbook"
      slice={slice}
      rows={({ facts }) => facts.engines}
      columns={engineColumns}
      // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
      rowKey={(row) => row.engine}
      emptyMessage="No AI engine answered yet."
    />
  );
}
