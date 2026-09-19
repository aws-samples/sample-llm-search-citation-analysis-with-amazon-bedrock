import {
  useEffect, useMemo, useState 
} from 'react';
import { useVisibilityMetrics } from '../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../hooks/usePersonaRankings';
import { useKeywordGroups } from '../../hooks/useKeywordGroups';
import type {
  Keyword, ReportScope 
} from '../../types';
import { isGroupVisibilityResponse } from '../../types/domain/visibility';
import {
  BrandRow, SummaryCards, TrendChart 
} from './VisibilityComponents';
import {
  GroupOverview, type HistoryRangeDays 
} from './GroupOverview';
import { PersonaSelector } from '../Personas/PersonaSelector';
import { PersonaComparisonChart } from './PersonaComparisonChart';
import { KeywordScopeSelector } from '../ui/KeywordScopeSelector';
import {
  ALL_SCOPE, decodeReportScope, describeReportScope, encodeReportScope, isReportScopeAvailable 
} from '../ui/reportScope';

interface Props { readonly keywords: Array<Keyword>; }

/**
 * Visibility dashboard. The scope selector picks a keyword (the classic
 * per-keyword view with brand rankings and personas) or a keyword group /
 * every keyword (the group overview: one score for the group, its history,
 * the per-keyword table and the brand ranking across keywords).
 */
export function VisibilityDashboard({ keywords }: Props) {
  const [scope, setScope] = useState<ReportScope>(ALL_SCOPE);
  const [rangeDays, setRangeDays] = useState<HistoryRangeDays>(30);
  const [selectedPersonaId, setSelectedPersonaId] = useState<string | null>(null);
  const { groups } = useKeywordGroups();
  const {
    data: visibility, loading: visLoading, error: visError, fetchVisibilityMetrics 
  } = useVisibilityMetrics();
  const {
    data: trends, loading: trendsLoading, fetchHistoricalTrends 
  } = useHistoricalTrends();
  const {
    data: personaRankings, fetchPersonaRankings 
  } = usePersonaRankings();

  const activeKeywords = useMemo(
    () => keywords.filter((keyword) => !keyword.status || keyword.status === 'active'),
    [keywords]
  );

  // A deleted group or keyword falls back to the whole account.
  useEffect(() => {
    if (!isReportScopeAvailable(scope, activeKeywords, groups) && (activeKeywords.length > 0 || groups.length > 0)) {
      setScope(ALL_SCOPE);
    }
  }, [scope, activeKeywords, groups]);

  const scopeKey = encodeReportScope(scope);
  const isKeywordScope = scope.kind === 'keyword';
  const historyDays = isKeywordScope ? 30 : rangeDays;

  useEffect(() => {
    if (activeKeywords.length === 0) return;
    const current = decodeReportScope(scopeKey);
    fetchVisibilityMetrics(current, selectedPersonaId ?? undefined);
    fetchHistoricalTrends(current, 'day', historyDays);
  }, [scopeKey, selectedPersonaId, historyDays, activeKeywords.length, fetchVisibilityMetrics, fetchHistoricalTrends]);

  useEffect(() => {
    const current = decodeReportScope(scopeKey);
    if (current.kind === 'keyword') fetchPersonaRankings(current.keyword);
  }, [scopeKey, fetchPersonaRankings]);

  const hasTrendData = trends?.trend_data && trends.trend_data.length > 0;
  const groupVisibility = visibility && isGroupVisibilityResponse(visibility) ? visibility : null;
  const keywordVisibility = visibility && !isGroupVisibilityResponse(visibility) ? visibility : null;

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-lg border border-gray-200 p-4 sm:p-6">
        <div className="flex flex-col gap-4">
          <div className="flex-1">
            <h2 className="text-lg sm:text-xl font-semibold text-gray-900">Visibility Dashboard</h2>
            <p className="text-sm text-gray-500 mt-2 leading-relaxed">Track how visible your brand is across AI search engines compared to competitors — for one keyword, a keyword group, or everything.</p>
          </div>
          <KeywordScopeSelector
            keywords={activeKeywords}
            groups={groups}
            value={scope}
            onChange={setScope}
            label="Analyze"
          />
          <PersonaSelector selectedPersonaId={selectedPersonaId} onPersonaChange={setSelectedPersonaId} />
        </div>
      </div>

      {(visLoading || trendsLoading) && <div className="text-center py-8 text-gray-500">Loading visibility data...</div>}

      {visError && !visLoading && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">{visError}</div>
      )}

      {groupVisibility && (
        <GroupOverview
          visibility={groupVisibility}
          trends={trends}
          scopeLabel={describeReportScope(scope, groups)}
          rangeDays={rangeDays}
          onRangeChange={setRangeDays}
        />
      )}

      {keywordVisibility && (
        <>
          <SummaryCards
            firstPartyScore={keywordVisibility.summary.first_party_avg_score}
            competitorScore={keywordVisibility.summary.competitor_avg_score}
            shareOfVoice={keywordVisibility.summary.first_party_total_sov}
            prominence={keywordVisibility.prominence}
            trendDirection={trends?.trend_direction}
            trendChange={trends?.summary?.change}
          />

          {hasTrendData && <TrendChart data={trends.trend_data} />}

          <div className="bg-white rounded-lg shadow overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-medium">Brand Rankings</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Brand</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Share of Voice</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Best Rank</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mentions</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Providers</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {keywordVisibility.brands.length > 0 ? keywordVisibility.brands.map((brand, index) => <BrandRow key={brand.name} brand={brand} index={index} />) : (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No brand data available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <PersonaComparisonChart data={personaRankings} />
        </>
      )}
    </div>
  );
}
