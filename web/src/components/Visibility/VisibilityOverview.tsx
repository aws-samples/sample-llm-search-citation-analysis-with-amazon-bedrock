import {
  useState, type ReactNode
} from 'react';
import type {
  HistoricalTrendsResponse, VisibilityResponse
} from '../../types';
import { formatDate } from '../../formatting/dateFormatter';
import {
  KpiHeadline, NO_PREVIOUS_RUN, runComparison
} from '../Reports/layout';
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
import { exportVisibilityOverview } from './visibilityOverviewExport';

interface Props {
  readonly visibility: VisibilityResponse;
  readonly trends: HistoricalTrendsResponse | null;
  readonly trendsError: string | null;
  readonly scopeLabel: string;
  readonly rangeDays: HistoryRangeDays;
  readonly onRangeChange: (days: HistoryRangeDays) => void;
  /** Scope-specific panels shown after the leaderboard, e.g. the persona comparison of one keyword. */
  readonly children?: ReactNode;
}

/** "1 of 2 keywords have analysis data · latest run …", and whether the scope was cut short. */
function scopeSummary(visibility: VisibilityResponse): string {
  const coverage = `${visibility.keywords_with_data} of ${visibility.keywords_analyzed} keywords have analysis data`;
  const latest = visibility.timestamp === null ? 'no analysis run yet' : `latest run ${formatDate(visibility.timestamp)}`;
  const truncated = visibility.keywords_truncated ? ` · only the first ${visibility.keywords.length} keywords are included` : '';
  return `${coverage} · ${latest}${truncated}`;
}

function ExportButton({
  visibility, trends, scopeLabel
}: Pick<Props, 'visibility' | 'trends' | 'scopeLabel'>) {
  const [exporting, setExporting] = useState(false);

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportVisibilityOverview(visibility, trends, scopeLabel);
    } catch (error) {
      console.error('[visibility] Excel export failed:', error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleExport}
      disabled={exporting}
      className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
    >
      {exporting ? 'Exporting…' : 'Export to Excel'}
    </button>
  );
}

/**
 * The Visibility tab for any scope (one keyword, a group, every keyword):
 * the KPIs of the latest runs with their change since the previous runs,
 * their history, every keyword, each brand's share of voice and the brand
 * leaderboard, the KPIs per AI engine and the most cited domains
 * (`docs/kpi-definitions.md`).
 */
export function VisibilityOverview({
  visibility, trends, trendsError, scopeLabel, rangeDays, onRangeChange, children
}: Props) {
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">{scopeLabel}</span>
          {` · ${scopeSummary(visibility)}`}
        </p>
        <ExportButton visibility={visibility} trends={trends} scopeLabel={scopeLabel} />
      </div>

      <OverviewPanel title="Headline">
        <KpiHeadline
          kpis={visibility.kpis}
          comparison={runComparison(visibility.change)}
          noComparisonNote={NO_PREVIOUS_RUN}
          citationsConfigured={visibility.citations_configured}
        />
      </OverviewPanel>

      <VisibilityHistory trends={trends} error={trendsError} rangeDays={rangeDays} onRangeChange={onRangeChange} />
      <KeywordVisibilityTable rows={visibility.keywords} />
      <BrandShareOfVoicePanel brands={visibility.brands} />
      <BrandLeaderboard brands={visibility.brands} />
      <EnginesPanel engines={visibility.engines} />
      <SourcesPanel sources={visibility.sources} total={visibility.sources_total} />
      {children}
      <VisibilityDefinitions />
    </div>
  );
}
