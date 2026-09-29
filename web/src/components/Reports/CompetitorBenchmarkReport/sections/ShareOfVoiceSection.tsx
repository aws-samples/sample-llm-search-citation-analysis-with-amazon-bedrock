import { ShareOfVoiceChart } from '../../charts';
import {
  LatestRunSection, type ScopeSectionProps
} from '../../scopeReport';

/** Each brand's share of all brand mentions in the latest runs, as a donut. */
export function ShareOfVoiceSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunSection
      report={report}
      title="Share of voice"
      subtitle="Each brand's share of all brand mentions in the latest runs; the smaller brands share one slice."
    >
      {(visibility) => <ShareOfVoiceChart brands={visibility.brands} />}
    </LatestRunSection>
  );
}
