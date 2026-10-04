import type { VisibilityResponse } from '../../../types';
import {
  KPI_DEFINITIONS, type KpiId
} from '../../../constants/kpiDefinitions';
import {
  formatKpi, formatKpiDelta
} from '../../../formatting/kpiFormatter';
import { formatDate } from '../../../formatting/dateFormatter';
import {
  OWNED_DOMAINS_MISSING, trendAccent
} from '../layout/KpiHeadline';
import {
  NO_PREVIOUS_RUN, runComparison
} from '../layout/periodComparison';
import { ReportStatCard } from '../layout/ReportStatCard';

/** The citation KPIs, measured only once owned domains are configured. */
const CITATION_KPIS: ReadonlySet<KpiId> = new Set<KpiId>(['citations', 'citation_rate', 'citation_share']);

/**
 * What the card says under a KPI of the latest runs: its change since each
 * keyword's previous run, or why there is none.
 */
function latestRunChangeNote(id: KpiId, visibility: VisibilityResponse): string {
  if (CITATION_KPIS.has(id) && !visibility.citations_configured) return OWNED_DOMAINS_MISSING;
  const comparison = runComparison(visibility.change);
  if (comparison === null) return NO_PREVIOUS_RUN;
  return `${formatKpiDelta(id, comparison.deltas[id])} ${comparison.label}`;
}

interface Props {
  readonly id: KpiId;
  readonly visibility: VisibilityResponse;
}

/**
 * A headline card of one KPI over the latest runs: its value, its change
 * since the previous run coloured by its trend, and its definition in a
 * tooltip (`docs/kpi-definitions.md`).
 */
export function KpiChangeCard({
  id, visibility
}: Props) {
  const spec = KPI_DEFINITIONS[id];
  return (
    <ReportStatCard
      label={spec.label}
      value={formatKpi(id, visibility.kpis[id])}
      footnote={latestRunChangeNote(id, visibility)}
      accent={trendAccent(runComparison(visibility.change)?.trends[id])}
      info={spec.definition}
    />
  );
}

/** "Each keyword's latest run (newest 8 Sep 2026): 20 AI answers over 1 keyword." */
export function latestRunsSubtitle({
  timestamp, kpis, keywords_with_data: keywords
}: VisibilityResponse): string {
  const newest = timestamp === null ? '' : ` (newest ${formatDate(timestamp)})`;
  const keywordCount = keywords === 1 ? '1 keyword' : `${keywords} keywords`;
  return `Each keyword's latest run${newest}: ${kpis.answers ?? 0} AI answers over ${keywordCount}.`;
}
