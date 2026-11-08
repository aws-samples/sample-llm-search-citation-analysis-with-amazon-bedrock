import { ShareOfVoiceChart } from '../../charts';
import {
  LatestRunSection, SCOPE_BRANDS_ANCHOR, type ScopeSectionProps
} from '../../scopeReport';
import { SeeAllLink } from '../../../ui/SeeAllLink';

/** Each brand's share of all brand mentions in the latest runs, as a donut. */
export function ShareOfVoiceSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunSection
      report={report}
      title="Share of voice"
      subtitle="Each brand's share of all brand mentions in the latest runs; the smaller brands share one slice."
    >
      {(visibility) => (
        <>
          <ShareOfVoiceChart brands={visibility.brands} />
          <p className="mt-2 text-right"><SeeAllLink to={`#${SCOPE_BRANDS_ANCHOR}`}>See all brands</SeeAllLink></p>
        </>
      )}
    </LatestRunSection>
  );
}
