import { TopSourcesChart } from '../../charts';
import {
  LatestRunSection, type ScopeSectionProps
} from '../../scopeReport';

/** The ten domains the answers cite most, your own highlighted. */
export function TopSourcesSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunSection
      report={report}
      title="Most cited domains"
      subtitle="The domains cited by the most answers in the latest runs; your owned domains are highlighted."
    >
      {(visibility) => <TopSourcesChart sources={visibility.sources} />}
    </LatestRunSection>
  );
}
