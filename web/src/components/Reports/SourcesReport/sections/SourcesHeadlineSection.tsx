import { ReportStatCard } from '../../layout/ReportStatCard';
import {
  KpiChangeCard, LatestRunHeadline, type ScopeSectionProps
} from '../../scopeReport';

const DOMAINS_CITED_INFO = 'How many distinct domains the answers cite as sources, yours and everyone else\'s.';

/** How often the answers cite your website, its share of every cited source, and how many domains they cite. */
export function SourcesHeadlineSection({ report }: ScopeSectionProps) {
  return (
    <LatestRunHeadline
      report={report}
      cards={(visibility) => (
        <>
          <KpiChangeCard id="citations" visibility={visibility} />
          <KpiChangeCard id="citation_rate" visibility={visibility} />
          <KpiChangeCard id="citation_share" visibility={visibility} />
          <ReportStatCard label="Domains cited" value={visibility.sources_total} info={DOMAINS_CITED_INFO} />
        </>
      )}
    />
  );
}
