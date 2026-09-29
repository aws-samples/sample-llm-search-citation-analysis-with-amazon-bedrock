import type { VisibilityResponse } from '../../../../types';
import { formatKpi } from '../../../../formatting/kpiFormatter';
import { ReportStatCard } from '../../layout/ReportStatCard';
import {
  KpiChangeCard, LatestRunHeadline, type ScopeSectionProps
} from '../../scopeReport';
import { benchmarkStanding } from '../benchmarkStanding';

export const RANK_INFO = 'Your brand\'s place among every brand the answers name, by visibility score (1 = the most visible).';

export const LEADER_INFO = 'The brand with the largest share of voice: the largest share of all brand mentions in the answers.';

export const BRANDS_NAMED_INFO = 'How many distinct brands the answers name: yours, competitors\' and others\'.';

function BenchmarkCards({ visibility }: { readonly visibility: VisibilityResponse }) {
  const {
    rank, leader, brandsNamed
  } = benchmarkStanding(visibility.brands);
  return (
    <>
      <KpiChangeCard id="share_of_voice" visibility={visibility} />
      <ReportStatCard
        label="Your rank"
        value={rank === null ? '—' : `#${rank} of ${brandsNamed}`}
        footnote={rank === null ? 'No answer names your brand' : 'By visibility score'}
        info={RANK_INFO}
      />
      <ReportStatCard
        label="Leading brand"
        value={leader?.name ?? '—'}
        footnote={leader === null ? 'No brand has a share of voice yet' : `${formatKpi('share_of_voice', leader.share_of_voice)} share of voice`}
        info={LEADER_INFO}
      />
      <ReportStatCard label="Brands named" value={brandsNamed} info={BRANDS_NAMED_INFO} />
    </>
  );
}

/** Your share of voice and rank, the brand leading the share of voice, and how many brands compete for it. */
export function BenchmarkHeadlineSection({ report }: ScopeSectionProps) {
  return <LatestRunHeadline report={report} cards={(visibility) => <BenchmarkCards visibility={visibility} />} />;
}
