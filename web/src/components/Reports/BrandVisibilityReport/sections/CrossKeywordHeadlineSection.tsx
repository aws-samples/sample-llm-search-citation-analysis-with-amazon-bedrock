import type { HistoricalTrendsResponse } from '../../../../types';
import {
  TrendHeadlineSection,
  gateSection,
} from '../../layout';

interface Props {
  readonly trends: HistoricalTrendsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * All-keywords headline: every KPI over each keyword's latest period, its
 * change since the previous period, and how many keywords improve, decline
 * or hold — all computed by `/trends`.
 */
export function CrossKeywordHeadlineSection({
  trends, loading, error 
}: Props) {
  const gate = gateSection({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading aggregate trends…',
    error,
    value: trends !== null && trends.keywords_with_data > 0 ? trends : null,
    emptyMessage: 'No aggregate trend data yet. Run an analysis to populate.',
  });
  if (!gate.ready) return gate.placeholder;

  return <TrendHeadlineSection kpis={gate.value.latest} standing={gate.value} counts={gate.value.overall} />;
}
