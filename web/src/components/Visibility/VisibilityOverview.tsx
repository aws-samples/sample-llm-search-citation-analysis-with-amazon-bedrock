import type { ReactNode } from 'react';
import type {
  HistoricalTrendsResponse, VisibilityResponse
} from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import { RunKpiHeadline } from '../Reports/layout';
import { BrandLeaderboard } from './BrandLeaderboard';
import { KeywordVisibilityTable } from './KeywordVisibilityTable';
import { OverviewPanel } from './OverviewPanel';
import {
  BrandShareOfVoicePanel, EnginesPanel, SourcesPanel
} from './VisibilityChartPanels';
import { VisibilityDefinitions } from './VisibilityDefinitions';
import {
  VisibilityHistory, type HistoryRangeDays
} from './VisibilityHistory';
import { ScopeCoverageNote } from '../ui/ScopeCoverageNote';
import { ScopedListFooter } from '../ui/ScopedListFooter';
import { ExportAllButton } from '../ui/ExportAllButton';
import {
  isBrandLeaderboardRow, isKeywordVisibilityRow, isSourceRow, VISIBILITY_BRANDS_PAGING, VISIBILITY_KEYWORD_PAGING, VISIBILITY_SOURCES_PAGING
} from '../../api/scopedListPagings';
import { useScopedList } from '../../hooks/useScopedList';
import type { ListRequest } from '../../api/scopedListPages';
import { requestParams } from '../../api/exports';

interface Props {
  readonly visibility: VisibilityResponse;
  /** The request `visibility` answered: its lists load their next pages with it, and it is what Export all exports. */
  readonly request?: ListRequest | null;
  readonly trends: HistoricalTrendsResponse | null;
  /** The request `trends` answered: the KPI history's export. */
  readonly trendsRequest?: ListRequest | null;
  readonly trendsError: string | null;
  /** The trends request is in flight. */
  readonly trendsLoading?: boolean;
  readonly scopeLabel: string;
  readonly rangeDays: HistoryRangeDays;
  readonly onRangeChange: (days: HistoryRangeDays) => void;
  /** Scope-specific panels shown after the leaderboard, e.g. the persona comparison of one keyword. */
  readonly children?: ReactNode;
}

/** "1 of 2 keywords have analysis data · latest run …"; how much of the scope is covered is the ScopeCoverageNote's. */
function scopeSummary(visibility: VisibilityResponse): string {
  const coverage = `${visibility.keywords_with_data} of ${visibility.keywords_analyzed} keywords have analysis data`;
  const latest = visibility.timestamp === null ? 'no analysis run yet' : `latest run ${formatDate(visibility.timestamp)}`;
  return `${coverage} · ${latest}`;
}

/**
 * The Visibility tab for any scope (one keyword, a group, every keyword):
 * the KPIs of the latest runs with their change since the previous runs,
 * their history, every keyword, each brand's share of voice and the brand
 * leaderboard, the KPIs per AI engine and the most cited domains
 * (`docs/kpi-definitions.md`). Every list pages to its end; every panel
 * exports its full data with the view's scope, persona and market.
 */
export function VisibilityOverview({
  visibility, request = null, trends, trendsRequest = null, trendsError, trendsLoading, scopeLabel, rangeDays, onRangeChange, children
}: Props) {
  const keywordList = useScopedList(visibility, request, VISIBILITY_KEYWORD_PAGING, isKeywordVisibilityRow);
  const brandList = useScopedList(visibility, request, VISIBILITY_BRANDS_PAGING, isBrandLeaderboardRow);
  const sourceList = useScopedList(visibility, request, VISIBILITY_SOURCES_PAGING, isSourceRow);
  const params = requestParams(request);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">{scopeLabel}</span>
          {` · ${scopeSummary(visibility)}`}
        </p>
        <ExportAllButton view="keyword-visibility" params={params} />
      </div>
      <ScopeCoverageNote response={visibility} />

      <OverviewPanel title="Headline">
        <RunKpiHeadline visibility={visibility} />
      </OverviewPanel>

      <VisibilityHistory
        trends={trends}
        error={trendsError}
        loading={trendsLoading}
        rangeDays={rangeDays}
        onRangeChange={onRangeChange}
        exportButton={<ExportAllButton view="trend-periods" params={requestParams(trendsRequest)} />}
      />
      <KeywordVisibilityTable rows={keywordList.items} footer={<ScopedListFooter list={keywordList} noun="keywords" />} />
      <BrandShareOfVoicePanel brands={visibility.brands} />
      <BrandLeaderboard
        brands={brandList.items}
        footer={<ScopedListFooter list={brandList} noun="brands" />}
        actions={<ExportAllButton view="brand-leaderboard" params={params} />}
      />
      <EnginesPanel engines={visibility.engines} actions={<ExportAllButton view="engines" params={params} />} />
      <SourcesPanel
        sources={sourceList.items}
        footer={<ScopedListFooter list={sourceList} noun="cited domains" />}
        actions={<ExportAllButton view="sources" params={params} />}
      />
      {children}
      <VisibilityDefinitions />
    </div>
  );
}
