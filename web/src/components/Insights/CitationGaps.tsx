import {
  useEffect, useMemo 
} from 'react';
import { useCitationGaps } from '../../hooks/useCitationGaps';
import type {
  CitationGapsResponse, Keyword
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
import { ComputingState } from '../ui/ComputingState';
import { ScopeCoverageNote } from '../ui/ScopeCoverageNote';
import { ScopedListFooter } from '../ui/ScopedListFooter';
import { ExportAllButton } from '../ui/ExportAllButton';
import { useScopedList } from '../../hooks/useScopedList';
import {
  GAP_SUMMARIES_PAGING, GAPS_PAGING, isCitationGap, isGapSummary
} from '../../api/scopedListPagings';
import type { ListRequest } from '../../api/scopedListPages';
import { requestParams } from '../../api/exports';
import type { ComputingResponse } from '../../types/domain/scopeCoverage';

interface Props { readonly keywords: Array<Keyword>; }

function StatCard({
  value, label, color
}: {
  readonly value: number | string;
  readonly label: string;
  readonly color: string
}) {
  return (
    <div className="bg-white p-3 sm:p-4 rounded-lg shadow-sm">
      <div className={`text-xl sm:text-2xl font-bold ${color}`}>{value}</div>
      <div className="text-xs sm:text-sm text-gray-500">{label}</div>
    </div>
  );
}

/** Where the domain summary's "See all gaps" points. */
const GAP_LIST_ANCHOR = 'citation-gaps-list';

function DomainSummary({ domains }: {
  readonly domains: Array<{
    domain: string;
    gap_count: number;
    total_citations: number
  }>
}) {
  return (
    <div className="bg-white p-4 rounded-lg shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-lg font-medium">Top Domains with Gaps</h3>
        <a href={`#${GAP_LIST_ANCHOR}`} className="print-hidden text-sm font-medium text-gray-700 underline hover:text-gray-900">See all gaps</a>
      </div>
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

/**
 * The gap cards a response opens with, as the `gaps` list `GAPS_PAGING` pages: `gaps` for one
 * keyword, `top_gaps` across keywords; the scope's gap count when the answer has no `gaps_total`.
 */
function gapListBody(data: CitationGapsResponse): CitationGapsResponse {
  return {
    ...data,
    gaps: data.gaps ?? data.top_gaps ?? [],
    gaps_total: data.gaps_total ?? data.total_gaps ?? data.summary?.gap_count,
  };
}

function GapList({
  data, request
}: {
  readonly data: CitationGapsResponse;
  readonly request: ListRequest | null;
}) {
  const body = useMemo(() => gapListBody(data), [data]);
  const list = useScopedList(body, request, GAPS_PAGING, isCitationGap);
  return (
    <>
      <div id={GAP_LIST_ANCHOR}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <h3 className="text-base sm:text-lg font-medium">Citation Gaps to Fill</h3>
          <ExportAllButton view="citation-gaps" params={requestParams(request)} />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {list.items.map(gap => (
            <GapCard key={`${gap.keyword ?? 'single'}:${gap.url}`} gap={gap} />
          ))}
        </div>
        <ScopedListFooter list={list} noun="gaps" />
      </div>

      {list.items.length === 0 && (
        <div className="text-center py-8 text-gray-500">No citation gaps found. Great coverage!</div>
      )}
    </>
  );
}

/** The gaps of each keyword of a scope, a page at a time (2.45.0); nothing for one keyword's answer. */
function KeywordGapSummaries({
  data, request
}: {
  readonly data: CitationGapsResponse;
  readonly request: ListRequest | null;
}) {
  const list = useScopedList(data, request, GAP_SUMMARIES_PAGING, isGapSummary);
  if (list.items.length === 0) return null;
  return (
    <div className="bg-white p-4 rounded-lg shadow-sm">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-lg font-medium">Gaps per keyword</h3>
        <ExportAllButton view="gap-keyword-summaries" params={requestParams(request)} />
      </div>
      <table aria-label="Gaps per keyword" className="min-w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-gray-500">
            <th className="py-2 pr-3 font-medium">Keyword</th>
            <th className="py-2 pr-3 font-medium">Gaps</th>
            <th className="py-2 pr-3 font-medium">High priority</th>
            <th className="py-2 font-medium">Coverage</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {list.items.map((row) => (
            <tr key={row.keyword}>
              <td className="py-2 pr-3 font-medium text-gray-700">{row.keyword}</td>
              <td className="py-2 pr-3 text-red-600">{row.gap_count}</td>
              <td className="py-2 pr-3">{row.high_priority_gaps}</td>
              <td className="py-2">{`${row.coverage_rate.toFixed(1)}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <ScopedListFooter list={list} noun="keywords" />
    </div>
  );
}

/** Stand-ins for the stat tiles, the domain summary and the gap cards while the gaps load. */
function CitationGapsSkeleton() {
  return (
    <SkeletonRegion label="Analyzing citation gaps" className="space-y-6">
      <StatTilesSkeleton count={4} gridClassName="grid-cols-2 lg:grid-cols-4" />
      <div className="bg-white p-4 rounded-lg shadow-sm">
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
  data, request, loading, computing, error
}: {
  readonly data: CitationGapsResponse | null;
  readonly request: ListRequest | null;
  readonly loading: boolean;
  readonly computing: ComputingResponse | null;
  readonly error: string | null;
}) {
  if (loading && computing !== null) return <ComputingState subject="citation gaps" />;
  if (loading) return <CitationGapsSkeleton />;
  if (error) {
    return <div className="text-center py-8 text-red-500">{error}</div>;
  }
  if (!data) return null;

  return (
    <>
      <ScopeCoverageNote response={data} />
      <GapStats
        summary={data.summary}
        totalGaps={data.total_gaps}
        totalHighPriority={data.total_high_priority}
      />
      {(data.domain_summary?.length ?? 0) > 0 && <DomainSummary domains={data.domain_summary} />}
      <KeywordGapSummaries data={data} request={request} />
      <GapList data={data} request={request} />
    </>
  );
}

export function CitationGaps({ keywords }: Props) {
  const selection = useScopeSelection();
  const {
    data, loading, error, computing, request, fetchCitationGaps
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
        request={request}
        loading={loading || selection.scopePending}
        computing={computing}
        error={error}
      />
    </div>
  );
}
