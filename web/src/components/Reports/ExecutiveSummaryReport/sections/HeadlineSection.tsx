import type { ReportsOverviewResponse } from '../../../../api/reports';
import {
  TrendHeadlineSection,
  gateSection,
  type ReportSlice,
} from '../../layout';
import { SeeAllLink } from '../../../ui/SeeAllLink';

/**
 * Top-of-deck answer to "are we winning, level or losing right now": every
 * KPI over each keyword's latest period with its change since the previous
 * period, and the breadth of the move — how many keywords improve, decline
 * or hold on the visibility score — as `/reports/overview` computes them.
 */
export function HeadlineSection({
  data, loading, error 
}: ReportSlice<ReportsOverviewResponse>) {
  const gate = gateSection({
    title: 'Headline',
    loading,
    loadingMessage: 'Loading executive summary…',
    error,
    value: data !== null && data.keywords_with_data > 0 ? data : null,
    emptyMessage: 'No analysis data yet. Run an analysis to populate the executive summary.',
  });
  if (!gate.ready) return gate.placeholder;

  const overview = gate.value;
  return (
    <>
      <TrendHeadlineSection kpis={overview.kpis} standing={overview} counts={overview.summary} />
      <p className="-mt-6 mb-8 text-right"><SeeAllLink to="/reports/visibility">See every keyword in Brand Visibility</SeeAllLink></p>
    </>
  );
}
