import {
  useEffect, useState 
} from 'react';
import { useCitationGaps } from '../../hooks/useCitationGaps';
import type {
  CitationGap, CitationGapsResponse, Keyword, ReportScope 
} from '../../types';
import { KeywordScopeSelector } from '../ui/KeywordScopeSelector';
import {
  ALL_SCOPE, decodeReportScope, encodeReportScope 
} from '../ui/reportScope';
import { useKeywordScopeOptions } from '../ui/useKeywordScopeOptions';
import { GapCard } from './GapCard';

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
        {domains.slice(0, 10).map(d => (
          <div key={d.domain} className="flex justify-between items-center py-2 border-b border-gray-100">
            <span className="font-medium text-gray-700">{d.domain}</span>
            <div className="flex gap-4 text-sm">
              <span className="text-red-600">{d.gap_count} gaps</span>
              <span className="text-gray-400">{d.total_citations} citations</span>
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
function gapsOf(data: CitationGapsResponse | null): CitationGap[] {
  return data?.gaps ?? data?.top_gaps ?? [];
}

function GapList({
  gaps, loading 
}: {
  readonly gaps: CitationGap[];
  readonly loading: boolean 
}) {
  return (
    <>
      <div>
        <h3 className="text-base sm:text-lg font-medium mb-3">Citation Gaps to Fill</h3>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {gaps.map(gap => <GapCard key={gap.url} gap={gap} />)}
        </div>
      </div>

      {gaps.length === 0 && !loading && <div className="text-center py-8 text-gray-500">No citation gaps found. Great coverage!</div>}
    </>
  );
}

export function CitationGaps({ keywords }: Props) {
  const [scope, setScope] = useState<ReportScope>(ALL_SCOPE);
  const {
    activeKeywords, groups 
  } = useKeywordScopeOptions(keywords);
  const {
    data, loading, error, fetchCitationGaps 
  } = useCitationGaps();
  const scopeKey = encodeReportScope(scope);

  useEffect(() => {
    fetchCitationGaps(decodeReportScope(scopeKey), 20);
  }, [scopeKey, fetchCitationGaps]);

  const hasDomainSummary = data?.domain_summary && data.domain_summary.length > 0;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex-1">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Citation Gap Analysis</h2>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">Discover sources that AI cites for competitors but not you.</p>
          </div>
          <KeywordScopeSelector
            keywords={activeKeywords}
            groups={groups}
            value={scope}
            onChange={setScope}
            label="Filter by keyword or group"
          />
        </div>
      </div>

      {data && <GapStats summary={data.summary} totalGaps={data.total_gaps} totalHighPriority={data.total_high_priority} />}

      {hasDomainSummary && <DomainSummary domains={data.domain_summary} />}

      {loading && <div className="text-center py-8 text-gray-500">Analyzing citation gaps...</div>}
      {error && <div className="text-center py-8 text-red-500">{error}</div>}

      <GapList gaps={gapsOf(data)} loading={loading} />
    </div>
  );
}

