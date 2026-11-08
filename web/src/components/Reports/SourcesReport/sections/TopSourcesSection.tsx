import { TopSourcesChart } from '../../charts';
import {
  LatestRunSection, SCOPE_SOURCES_ANCHOR, type ScopeSectionProps
} from '../../scopeReport';
import { SeeAllLink } from '../../../ui/SeeAllLink';

/** The ten domains the answers cite most, your own highlighted. */
export function TopSourcesSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunSection
      report={report}
      title="Most cited domains"
      subtitle="The domains cited by the most answers in the latest runs; your owned domains are highlighted."
    >
      {(visibility) => (
        <>
          <TopSourcesChart sources={visibility.sources} />
          <p className="mt-2 text-right"><SeeAllLink to={`#${SCOPE_SOURCES_ANCHOR}`}>See all domains</SeeAllLink></p>
        </>
      )}
    </LatestRunSection>
  );
}
