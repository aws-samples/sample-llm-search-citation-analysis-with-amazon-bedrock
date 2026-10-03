import type { VisibilityResponse } from '../../../types';
import { KpiHeadline } from './KpiHeadline';
import {
  NO_PREVIOUS_RUN, runComparison
} from './periodComparison';

/** The KPIs of a scope's latest runs (`GET /visibility`), each with its change since the previous runs. */
export function RunKpiHeadline({ visibility }: { readonly visibility: VisibilityResponse }) {
  return (
    <KpiHeadline
      kpis={visibility.kpis}
      comparison={runComparison(visibility.change)}
      noComparisonNote={NO_PREVIOUS_RUN}
      citationsConfigured={visibility.citations_configured}
    />
  );
}
