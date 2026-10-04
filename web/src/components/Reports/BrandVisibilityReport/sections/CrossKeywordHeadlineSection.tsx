import {
  TrendHeadlineSection,
  gateSection,
  type TrendSectionProps,
} from '../../layout';

/**
 * All-keywords headline: every KPI over each keyword's latest period, its
 * change since the previous period, and how many keywords improve, decline
 * or hold — all computed by `/trends`.
 */
export function CrossKeywordHeadlineSection({
  trends, loading, error 
}: TrendSectionProps) {
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
