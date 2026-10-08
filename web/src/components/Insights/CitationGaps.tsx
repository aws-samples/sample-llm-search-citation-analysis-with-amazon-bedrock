import { useEffect } from 'react';
import { useCitationGaps } from '../../hooks/useCitationGaps';
import type {
  CitationGap, CitationGapsResponse, Keyword
} from '../../types';
import {
  Skeleton, SkeletonRegion, SkeletonTable
} from '../ui/Skeleton';
import {
  InsightCardGridSkeleton, StatTilesSkeleton
} from './InsightsSkeletons';
import { GapCard } from './GapCard';
import { InsightsScopeSelector } from './InsightsScopeSelector';
import { useScopeSelection } from './useScopeSelection';
import { PageHeaderCard } from '../ui/PageHeaderCard';

interface Props { readonly keywords: Array<Keyword>; }

function StatCard({
  value, label, color
}: {
  readonly value: number | string;
  readonly label: string;
  readonly color: string
}) {
  return (
    <div className="bg-white p-3 sm:p-4 rounded-lg shadow">
      <div className={`text-xl sm:text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs sm:text-sm text-gray-500">{label}</div>
    </div>
  );
}

function DomainSummary({ domains }: {
  readonly domains: Array<{
    domain: string;
    gap_count: number;
    total_citations: number
  }>
}) {
  return (
    <div className="bg-white p-4 rounded-lg shadow">
      <h3 className="text-lg font-medium mb-3">Top Domains with Gaps</h3>
      <div className="space-y-2">
        {domains.slice(0, 10).map(domain => (
          <div key={domain.domain} className="flex justify-between items-center py-2 border-b border-gray-100">
            <span className="font-medium text-gray-700">{domain.domain}</span>
            <div className="flex gap-4 text-sm">
              <span className="text-red-600">{domain.gap_count} gaps</span>
              <span className="text-gray-400">{domain.total_citations} citations</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

interface GapSummary {
  gap_count?: number;
  high_priority_gaps?: number;
  covered_count?: number;
  coverage_rate?: number;
}

function GapStats({
  summary, totalGaps, totalHighPriority
}: {
  readonly summary?: GapSummary;
  readonly totalGaps?: number;
  readonly totalHighPriority?: number
}) {
  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
      <StatCard value={summary?.gap_count ?? totalGaps ?? 0} label="Total Gaps" color="text-gray-900" />
      <StatCard value={summary?.high_priority_gaps ?? totalHighPriority ?? 0} label="High Priority" color="text-red-600" />
      <StatCard value={summary?.covered_count ?? 0} label="Covered" color="text-green-600" />
      <StatCard value={`${summary?.coverage_rate?.toFixed(1) ?? 0}%`} label="Coverage" color="text-blue-600" />
    </div>
  );
}

/** The gaps a response carries: `gaps` for one keyword, `top_gaps` across keywords. */
function gapsOf(data: CitationGapsResponse): CitationGap[] {
  return data.gaps ?? data.top_gaps ?? [];
}

function GapList({ gaps }: { readonly gaps: CitationGap[] }) {
  return (
    <>
      <div>
        <h3 className="text-base sm:text-lg font-medium mb-3">Citation Gaps to Fill</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {gaps.map(gap => (
            <GapCard key={`${gap.keyword ?? 'single'}:${gap.url}`} gap={gap} />
          ))}
        </div>
      </div>

      {gaps.length === 0 && (
        <div className="text-center py-8 text-gray-500">No citation gaps found. Great coverage!</div>
      )}
    </>
  );
}

/** Stand-ins for the stat tiles, the domain summary and the gap cards while the gaps load. */
function CitationGapsSkeleton() {
  return (
    <SkeletonRegion label="Analyzing citation gaps" className="space-y-6">
      <StatTilesSkeleton count={4} gridClassName="grid-cols-2 lg:grid-cols-4" />
      <div className="bg-white p-4 rounded-lg shadow">
        <div className="flex h-7 items-center mb-3"><Skeleton className="h-5 w-48" /></div>
        <SkeletonTable rows={10} columns={2} rowClassName="h-[41px]" />
      </div>
      <div>
        <div className="flex h-7 items-center mb-3"><Skeleton className="h-5 w-44" /></div>
        <InsightCardGridSkeleton cardClassName="h-44" />
      </div>
    </SkeletonRegion>
  );
}

function CitationGapResults({
  data, loading, error
}: {
  readonly data: CitationGapsResponse | null;
  readonly loading: boolean;
  readonly error: string | null;
}) {
  if (loading) return <CitationGapsSkeleton />;
  if (error) {
    return <div className="text-center py-8 text-red-500">{error}</div>;
  }
  if (!data) return null;

  const gaps = gapsOf(data);
  return (
    <>
      <GapStats
        summary={data.summary}
        totalGaps={data.total_gaps}
        totalHighPriority={data.total_high_priority}
      />
      {(data.domain_summary?.length ?? 0) > 0 && <DomainSummary domains={data.domain_summary} />}
      <GapList gaps={gaps} />
    </>
  );
}

export function CitationGaps({ keywords }: Props) {
  const selection = useScopeSelection();
  const {
    data, loading, error, fetchCitationGaps
  } = useCitationGaps();

  useEffect(
    () => selection.trackScopeRequest(fetchCitationGaps(selection.scope, 20)),
    [selection.scope, fetchCitationGaps, selection.trackScopeRequest],
  );

  return (
    <div className="space-y-6">
      <PageHeaderCard title="Citation Gap Analysis" description="Discover sources that AI cites for competitors but not you.">
        <InsightsScopeSelector keywords={keywords} selection={selection} label="Filter by keyword or group" />
      </PageHeaderCard>

      <CitationGapResults
        data={data}
        loading={loading || selection.scopePending}
        error={error}
      />
    </div>
  );
}
