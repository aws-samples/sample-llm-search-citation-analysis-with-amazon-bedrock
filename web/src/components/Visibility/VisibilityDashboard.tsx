import {
  useEffect, useState
} from 'react';
import { useVisibilityMetrics } from '../../hooks/useVisibilityMetrics';
import { useHistoricalTrends } from '../../hooks/useHistoricalTrends';
import { usePersonaRankings } from '../../hooks/usePersonaRankings';
import type {
  Keyword, ReportScope
} from '../../types';
import { InsightsSummary } from './InsightsSummary';
import { VisibilityOverview } from './VisibilityOverview';
import { VisibilityOverviewSkeleton } from './VisibilitySkeletons';
import type { HistoryRangeDays } from './VisibilityHistory';
import { PersonaComparisonChart } from './PersonaComparisonChart';
import { PersonaSelector } from '../Personas/PersonaSelector';
import { KeywordScopeSelector } from '../ui/KeywordScopeSelector';
import { PageHeaderCard } from '../ui/PageHeaderCard';
import {
  ALL_SCOPE, decodeReportScope, describeReportScope, encodeReportScope, isReportScopeAvailable
} from '../ui/reportScope';
import { useKeywordScopeOptions } from '../ui/useKeywordScopeOptions';

interface Props { readonly keywords: Array<Keyword>; }

/**
 * Visibility dashboard. The scope selector picks one keyword, a keyword group
 * or every keyword; every scope gets its top insights and the same overview
 * (KPIs, history, keywords, share of voice, brand leaderboard, AI engines,
 * cited domains), and a single keyword adds how each persona ranks the brands.
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
    data: trends, loading: trendsLoading, error: trendsError, fetchHistoricalTrends
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

  useEffect(() => {
    if (activeKeywords.length === 0) return;
    const current = decodeReportScope(scopeKey);
    fetchVisibilityMetrics(current, selectedPersonaId ?? undefined);
    fetchHistoricalTrends(current, 'day', rangeDays);
  }, [scopeKey, selectedPersonaId, rangeDays, activeKeywords.length, fetchVisibilityMetrics, fetchHistoricalTrends]);

  useEffect(() => {
    const current = decodeReportScope(scopeKey);
    if (current.kind === 'keyword') fetchPersonaRankings(current.keyword);
  }, [scopeKey, fetchPersonaRankings]);

  return (
    <div className="space-y-6">
      <PageHeaderCard
        title="Visibility Dashboard"
        description="Track how visible your brand is across AI search engines compared to competitors — for one keyword, a keyword group, or everything."
      >
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
      </PageHeaderCard>

      {visError && !visLoading && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">{visError}</div>
      )}

      {activeKeywords.length > 0 && <InsightsSummary scope={scope} days={rangeDays} />}

      {/* First load: an overview-shaped placeholder where the overview will be.
          Later requests (scope, persona, range) keep the overview on screen,
          dimmed and marked busy, instead of inserting a notice above it. */}
      {!visibility && visLoading && <VisibilityOverviewSkeleton />}

      {visibility && (
        <div aria-busy={visLoading} className={visLoading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <VisibilityOverview
            visibility={visibility}
            trends={trends}
            trendsError={trendsError}
            trendsLoading={trendsLoading}
            scopeLabel={describeReportScope(scope, groups)}
            rangeDays={rangeDays}
            onRangeChange={setRangeDays}
          >
            {scope.kind === 'keyword' && <PersonaComparisonChart data={personaRankings} />}
          </VisibilityOverview>
        </div>
      )}
    </div>
  );
}
