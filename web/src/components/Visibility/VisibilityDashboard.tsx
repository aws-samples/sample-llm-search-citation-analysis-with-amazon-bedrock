import {
  useEffect, useState
} from 'react';
import { useVisibilityMetrics } from '../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../hooks/usePersonaRankings';
import type {
  GroupVisibilityResponse, Keyword, ReportScope, VisibilityMetricsResponse, VisibilityResponse
} from '../../types';
import { isGroupVisibilityResponse } from '../../types/domain/visibility';
import {
  GroupOverview, type HistoryRangeDays
} from './GroupOverview';
import { KeywordVisibilityPanel } from './KeywordVisibilityPanel';
import { PersonaSelector } from '../Personas/PersonaSelector';
import { KeywordScopeSelector } from '../ui/KeywordScopeSelector';
import {
  ALL_SCOPE, decodeReportScope, describeReportScope, encodeReportScope, isReportScopeAvailable
} from '../ui/reportScope';
import { useKeywordScopeOptions } from '../ui/useKeywordScopeOptions';

interface Props { readonly keywords: Array<Keyword>; }

interface SplitVisibility {
  readonly groupVisibility: GroupVisibilityResponse | null;
  readonly keywordVisibility: VisibilityMetricsResponse | null;
}

/** A response is a group overview or one keyword's metrics; the other view gets null. */
function splitVisibility(visibility: VisibilityResponse | null): SplitVisibility {
  if (visibility === null) {
    return {
      groupVisibility: null,
      keywordVisibility: null
    };
  }
  if (isGroupVisibilityResponse(visibility)) {
    return {
      groupVisibility: visibility,
      keywordVisibility: null
    };
  }
  return {
    groupVisibility: null,
    keywordVisibility: visibility
  };
}

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
  const {
    activeKeywords, groups
  } = useKeywordScopeOptions(keywords);
  const {
    data: visibility, loading: visLoading, error: visError, fetchVisibilityMetrics
  } = useVisibilityMetrics();
  const {
    data: trends, loading: trendsLoading, fetchHistoricalTrends
  } = useHistoricalTrends();
  const {
    data: personaRankings, fetchPersonaRankings
  } = usePersonaRankings();

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

  const {
    groupVisibility, keywordVisibility
  } = splitVisibility(visibility);

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
          <PersonaSelector
            id="visibility-persona-filter"
            name="visibility-persona-filter"
            selectedPersonaId={selectedPersonaId}
            onPersonaChange={setSelectedPersonaId}
          />
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
        <KeywordVisibilityPanel visibility={keywordVisibility} trends={trends} personaRankings={personaRankings} />
      )}
    </div>
  );
}
