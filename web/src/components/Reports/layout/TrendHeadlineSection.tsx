import type { HistoricalTrendsResponse } from '../../../types';
import type { BrandKpis } from '../../../types/domain/groupKpiHistory';
import { KpiHeadline } from './KpiHeadline';
import {
  KeywordTrendCounts, type KeywordTrendCountValues
} from './KeywordTrendCounts';
import {
  NO_PREVIOUS_PERIOD, periodComparison
} from './periodComparison';
import { ReportSection } from './ReportSection';

/** What `GET /trends` and `GET /reports/overview` both say about a scope's latest standing. */
type TrendStanding = Pick<
  HistoricalTrendsResponse,
  'change' | 'citations_configured' | 'days_analyzed' | 'keywords_analyzed' | 'keywords_with_data' | 'period_type'
>;

interface Props {
  /** Every KPI over each keyword's latest period, pooled. */
  readonly kpis: BrandKpis;
  readonly standing: TrendStanding;
  readonly counts: KeywordTrendCountValues;
}

function headlineSubtitle(kpis: BrandKpis, standing: TrendStanding): string {
  return `Each keyword's latest ${standing.period_type} in the last ${standing.days_analyzed} days — `
    + `${kpis.answers ?? 0} AI answers across ${standing.keywords_with_data} of ${standing.keywords_analyzed} keywords.`;
}

/**
 * A scope's KPIs over each keyword's latest period, their change against the
 * previous period (like for like), and how many keywords improve, decline or
 * hold on the visibility score.
 */
export function TrendHeadlineSection({
  kpis, standing, counts
}: Props) {
  return (
    <ReportSection title="Headline" subtitle={headlineSubtitle(kpis, standing)}>
      <KpiHeadline
        kpis={kpis}
        comparison={periodComparison(standing.change, standing.period_type)}
        noComparisonNote={NO_PREVIOUS_PERIOD}
        citationsConfigured={standing.citations_configured}
      />
      <KeywordTrendCounts counts={counts} keywordsWithData={standing.keywords_with_data} />
    </ReportSection>
  );
}
