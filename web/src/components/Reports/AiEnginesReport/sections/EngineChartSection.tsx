import { EngineKpiChart } from '../../charts';
import {
  LatestRunSection, type ScopeSectionProps
} from '../../scopeReport';

/** Mention rate, visibility score and citation rate side by side for each AI engine. */
export function EngineChartSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunSection
      report={report}
      title="KPIs per engine"
      subtitle="Your mention rate, visibility score and citation rate in each AI engine's answers, on a 0–100 scale."
    >
      {(visibility) => <EngineKpiChart engines={visibility.engines} />}
    </LatestRunSection>
  );
}
