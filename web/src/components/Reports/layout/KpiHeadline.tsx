import type {
  BrandKpis, KpiDeltas, KpiTrend
} from '../../../types/domain/groupKpiHistory';
import {
  formatKpi, formatKpiDelta
} from '../../../formatting/kpiFormatter';
import {
  KPI_DEFINITIONS, KPI_SPECS, type KpiId, type KpiSpec
} from '../../../constants/kpiDefinitions';
import { InfoTooltip } from '../../ui/InfoTooltip';
import type { ReportAccent } from './reportAccent';
import { ReportStatCard } from './ReportStatCard';
import { ReportStatGrid } from './ReportStatGrid';
import {
  ReportTable, type ReportTableColumn
} from './ReportTable';

/** A comparison with an earlier run or period: every KPI's delta, each rate's trend, and what it compares with. */
export interface KpiComparison {
  readonly deltas: KpiDeltas;
  readonly trends: Partial<Record<KpiId, KpiTrend>>;
  /** Appended to each change, e.g. "since 12 Sep 2026" or "vs previous day (3 keywords)". */
  readonly label: string;
}

interface Props {
  readonly kpis: BrandKpis;
  /** `null` when there is nothing to compare with yet. */
  readonly comparison: KpiComparison | null;
  /** Shown instead of a change when there is no comparison. */
  readonly noComparisonNote: string;
  /** Whether owned domains are configured, so the citation KPIs are measured. */
  readonly citationsConfigured: boolean;
}

/** The four KPIs on the headline cards; every KPI is in the table below them. */
export const HEADLINE_KPIS: readonly KpiId[] = ['mention_rate', 'share_of_voice', 'visibility_score', 'citation_rate'];

export const OWNED_DOMAINS_MISSING = 'Set owned domains in Settings › Brand Tracking to measure citations';

const TREND_LABELS: Record<KpiTrend, string> = {
  improving: 'Improving',
  declining: 'Declining',
  stable: 'Stable',
};

/** The colour a trend deserves: improving is positive, declining negative, stable or unknown neutral. */
export function trendAccent(trend: KpiTrend | undefined): ReportAccent {
  if (trend === 'improving') return 'positive';
  if (trend === 'declining') return 'negative';
  return 'neutral';
}

function changeText(id: KpiId, comparison: KpiComparison | null, noComparisonNote: string): string {
  if (comparison === null) return noComparisonNote;
  return `${formatKpiDelta(id, comparison.deltas[id])} ${comparison.label}`;
}

function kpiTableColumns(kpis: BrandKpis, comparison: KpiComparison | null): ReadonlyArray<ReportTableColumn<KpiSpec>> {
  return [
    {
      header: 'KPI',
      // Stryker disable next-line StringLiteral: Tailwind-only cell styling
      cellClassName: 'whitespace-nowrap font-medium',
      render: (spec) => (
        <>
          {spec.label}
          <InfoTooltip label={spec.label} text={spec.definition} />
        </>
      ),
    },
    {
      header: 'Value',
      render: (spec) => formatKpi(spec.id, kpis[spec.id]),
    },
    {
      header: 'Change',
      render: (spec) => (comparison === null ? '—' : formatKpiDelta(spec.id, comparison.deltas[spec.id])),
    },
    {
      header: 'Trend',
      render: (spec) => {
        const trend = comparison?.trends[spec.id];
        return trend === undefined ? '—' : TREND_LABELS[trend];
      },
    },
  ];
}

/**
 * A scope's KPIs: four headline cards, then every KPI with its change and
 * trend, each with a tooltip saying how it is measured
 * (`docs/kpi-definitions.md`).
 */
export function KpiHeadline({
  kpis, comparison, noComparisonNote, citationsConfigured
}: Props) {
  return (
    <>
      <ReportStatGrid columns={4}>
        {HEADLINE_KPIS.map((id) => (
          <ReportStatCard
            key={id}
            label={KPI_DEFINITIONS[id].label}
            value={formatKpi(id, kpis[id])}
            footnote={id === 'citation_rate' && !citationsConfigured ? OWNED_DOMAINS_MISSING : changeText(id, comparison, noComparisonNote)}
            accent={trendAccent(comparison?.trends[id])}
            info={KPI_DEFINITIONS[id].definition}
          />
        ))}
      </ReportStatGrid>
      <div className="mt-4">
        {
          // Stryker disable next-line ArrowFunction: React row key only; the rendered rows are identical
          <ReportTable columns={kpiTableColumns(kpis, comparison)} rows={KPI_SPECS} rowKey={(spec) => spec.id} />
        }
      </div>
    </>
  );
}
