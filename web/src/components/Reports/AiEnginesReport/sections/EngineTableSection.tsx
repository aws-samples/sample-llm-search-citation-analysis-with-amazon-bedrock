import type { VisibilityResponse } from '../../../../types';
import { EngineKpiTable } from '../../layout/EngineKpiTable';
import {
  LatestRunSection, type ScopeSectionProps
} from '../../scopeReport';

function noEngine({ engines }: VisibilityResponse): string | null {
  return engines.length === 0 ? 'No AI engine answered yet.' : null;
}

/** One row per AI engine with every KPI of your brand over that engine's answers. */
export function EngineTableSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunSection
      report={report}
      title="Every KPI per engine"
      subtitle="Each KPI of your brand over one AI engine's answers in the latest runs, engines in name order."
      emptyMessage={noEngine}
    >
      {({ engines }) => <EngineKpiTable engines={engines} />}
    </LatestRunSection>
  );
}
