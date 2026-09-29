import type { VisibilityResponse } from '../../../../types';
import {
  ReportSection,
  ReportSectionPlaceholder,
  gateSection,
} from '../../layout';
import {
  ChartPanel, EngineKpiChart
} from '../../charts';
import { EngineKpiTable } from '../../layout/EngineKpiTable';

interface Props {
  readonly visibility: VisibilityResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}

const TITLE = 'KPIs per AI engine';

export const ENGINE_CHART_TITLE = 'AI engines compared';
export const ENGINE_CHART_SUBTITLE = 'Mention rate, visibility score and citation rate of each AI engine\'s answers alone, on a 0–100 scale.';

/**
 * Every KPI of this keyword's latest run per AI engine: the engines compared
 * as grouped bars, then a table of their KPIs. It sits before the provider
 * differences, which say where each engine ranks the first-party brands.
 */
export function EngineKpisSection({
  visibility, loading, error
}: Props) {
  const gate = gateSection({
    title: TITLE,
    loading,
    loadingMessage: 'Loading AI engine KPIs…',
    error,
    value: visibility,
  });
  if (!gate.ready) return gate.placeholder;

  const { engines } = gate.value;
  if (engines.length === 0) {
    return <ReportSectionPlaceholder title={TITLE} variant="empty" message="No AI engine has answered for this keyword yet." />;
  }

  return (
    <ReportSection title={TITLE} subtitle="This keyword's KPIs over each AI engine's answers in its latest run, engines by name.">
      <ChartPanel title={ENGINE_CHART_TITLE} subtitle={ENGINE_CHART_SUBTITLE} className="mb-4">
        <EngineKpiChart engines={engines} />
      </ChartPanel>
      <EngineKpiTable engines={engines} />
    </ReportSection>
  );
}
