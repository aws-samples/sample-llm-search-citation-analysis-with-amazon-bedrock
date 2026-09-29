import type { VisibilityResponse } from '../../../../types';
import { formatKpi } from '../../../../formatting/kpiFormatter';
import { engineName } from '../../charts';
import { ReportStatCard } from '../../layout/ReportStatCard';
import {
  KpiChangeCard, LatestRunHeadline, type ScopeSectionProps
} from '../../scopeReport';
import { engineCoverage } from '../engineCoverage';

export const ENGINES_ANSWERING_INFO = 'The AI engines with at least one answer in the latest runs.';

export const ENGINES_NAMING_INFO = 'The AI engines with at least one answer that names your brand.';

export const STRONGEST_ENGINE_INFO = 'The AI engine whose answers give your brand the highest visibility score.';

function EngineCards({ visibility }: { readonly visibility: VisibilityResponse }) {
  const {
    answering, naming, strongest
  } = engineCoverage(visibility.engines);
  return (
    <>
      <KpiChangeCard id="engine_coverage" visibility={visibility} />
      <ReportStatCard label="Engines answering" value={answering} info={ENGINES_ANSWERING_INFO} />
      <ReportStatCard
        label="Engines naming you"
        value={naming}
        footnote={`of ${answering} answering`}
        info={ENGINES_NAMING_INFO}
      />
      <ReportStatCard
        label="Strongest engine"
        value={strongest === null ? '—' : engineName(strongest.engine)}
        footnote={strongest === null ? 'No visibility score yet' : `Visibility score ${formatKpi('visibility_score', strongest.kpis.visibility_score)}`}
        info={STRONGEST_ENGINE_INFO}
      />
    </>
  );
}

/** How many AI engines answer, how many name your brand, and where it is most visible. */
export function EngineHeadlineSection({ report }: ScopeSectionProps) {
  return <LatestRunHeadline report={report} cards={(visibility) => <EngineCards visibility={visibility} />} />;
}
