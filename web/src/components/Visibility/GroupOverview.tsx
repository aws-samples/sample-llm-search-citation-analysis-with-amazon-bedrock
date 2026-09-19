import { useState } from 'react';
import type {
  GroupBrandVisibilityMetric, GroupVisibilityResponse, HistoricalTrendsResponse, KeywordVisibilityRow
} from '../../types';
import {
  formatRank, TrendChart
} from './VisibilityComponents';
import { exportGroupOverview } from './groupOverviewExport';

export type HistoryRangeDays = 7 | 30 | 90;
export const HISTORY_RANGES: readonly HistoryRangeDays[] = [7, 30, 90];

interface GroupOverviewProps {
  readonly visibility: GroupVisibilityResponse;
  readonly trends: HistoricalTrendsResponse | null;
  readonly scopeLabel: string;
  readonly rangeDays: HistoryRangeDays;
  readonly onRangeChange: (days: HistoryRangeDays) => void;
}

/** Group visibility, prominence, history and keyword-level detail. */
export function GroupOverview({
  visibility, trends, scopeLabel, rangeDays, onRangeChange
}: GroupOverviewProps) {
  const [exporting, setExporting] = useState(false);
  const { summary } = visibility;

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportGroupOverview(visibility, trends, scopeLabel);
    } catch (error) {
      console.error('[visibility] Excel export failed:', error);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">{scopeLabel}</span>
          {' · '}
          {visibility.keywords_with_data} of {visibility.keywords_analyzed} keywords have analysis data
          {visibility.keywords_truncated === true && ' (first 100 keywords shown)'}
        </div>
        <button
          type="button"
          onClick={handleExport}
          disabled={exporting}
          className="px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50"
        >
          {exporting ? 'Exporting…' : 'Export to Excel'}
        </button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        <KpiCard label="Your visibility" value={summary.first_party_avg_score} suffix="/100" border="border-green-500" />
        <KpiCard label="Competitor visibility" value={summary.competitor_avg_score} suffix="/100" border="border-red-500" />
        <KpiCard label="Your share of voice" value={summary.first_party_avg_sov} suffix="%" border="border-blue-500" />
        <KpiCard label="Citation rate" value={summary.coverage_rate} suffix="%" border="border-purple-500" hint="keywords mentioning you" />
        <KpiCard
          label="Prominence"
          value={summary.rank_1_share}
          suffix="%"
          border="border-fuchsia-500"
          hint={`rank-#1 share · top-3 ${summary.top_3_share}% · mean rank ${formatRank(summary.mean_rank)}`}
        />
        <KpiCard label="Provider coverage" value={summary.provider_coverage} suffix="%" border="border-amber-500" hint="of enabled AI engines" />
      </div>

      <div className="bg-white p-4 rounded-lg shadow space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-lg font-medium">Group visibility history</h3>
          <fieldset className="flex gap-1 border-0 p-0 m-0">
            <legend className="sr-only">History range</legend>
            {HISTORY_RANGES.map((days) => (
              <button
                key={days}
                type="button"
                onClick={() => onRangeChange(days)}
                aria-pressed={rangeDays === days}
                className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  rangeDays === days ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:bg-gray-100'
                }`}
              >
                {days} days
              </button>
            ))}
          </fieldset>
        </div>
        {trends && trends.trend_data.length > 0 ? (
          <TrendChart data={trends.trend_data} title={`Mean first-party visibility (last ${rangeDays} days)`} />
        ) : (
          <p className="text-sm text-gray-500">No analysis runs in this range yet.</p>
        )}
        {trends?.summary && (
          <p className="text-xs text-gray-500">
            Trend: {trends.trend_direction} · change {trends.summary.change >= 0 ? '+' : ''}{trends.summary.change} vs previous period · average {trends.summary.average_score}
          </p>
        )}
      </div>

      <KeywordTable rows={visibility.keywords} />
      <GroupBrandTable brands={visibility.brands} />
    </div>
  );
}

function KpiCard({
  label, value, suffix, border, hint
}: {
  readonly label: string;
  readonly value: number;
  readonly suffix: string;
  readonly border: string;
  readonly hint?: string;
}) {
  return (
    <div className={`bg-white p-3 sm:p-4 rounded-lg shadow border-l-4 ${border}`}>
      <div className="text-xs sm:text-sm text-gray-500">{label}</div>
      <div className="text-xl sm:text-2xl font-bold text-gray-900">{value}<span className="text-sm font-normal text-gray-400">{suffix}</span></div>
      {hint && <div className="text-xs text-gray-400 mt-0.5">{hint}</div>}
    </div>
  );
}

type KeywordSortKey =
  | 'keyword'
  | 'first_party_score'
  | 'competitor_score'
  | 'first_party_sov'
  | 'first_party_best_rank'
  | 'total_mentions';

function compareNumbers(left: number | null, right: number | null, descending: boolean): number {
  if (left === null) return right === null ? 0 : 1;
  if (right === null) return -1;
  return descending ? right - left : left - right;
}

function sortRows(rows: KeywordVisibilityRow[], key: KeywordSortKey, descending: boolean): KeywordVisibilityRow[] {
  return [...rows].sort((left, right) => {
    if (key === 'keyword') {
      const comparison = left.keyword.localeCompare(right.keyword, undefined, { sensitivity: 'base' });
      return descending ? -comparison : comparison;
    }
    if (key === 'first_party_best_rank') {
      const leftRank = formatRank(left.first_party_best_rank) === '—' ? null : left.first_party_best_rank;
      const rightRank = formatRank(right.first_party_best_rank) === '—' ? null : right.first_party_best_rank;
      return compareNumbers(leftRank, rightRank, descending);
    }
    return compareNumbers(left[key], right[key], descending);
  });
}

const KEYWORD_COLUMNS: readonly {
  key: KeywordSortKey;
  label: string
}[] = [
  {
    key: 'keyword',
    label: 'Keyword'
  },
  {
    key: 'first_party_score',
    label: 'Your score'
  },
  {
    key: 'competitor_score',
    label: 'Competitor score'
  },
  {
    key: 'first_party_sov',
    label: 'Your SoV'
  },
  {
    key: 'first_party_best_rank',
    label: 'Best rank'
  },
  {
    key: 'total_mentions',
    label: 'Mentions'
  },
];

function sortDirection(active: boolean, descending: boolean): 'ascending' | 'descending' | undefined {
  if (!active) return undefined;
  return descending ? 'descending' : 'ascending';
}

/** Sortable per-keyword breakdown; unavailable ranks and no-data rows stay last. */
function KeywordTable({ rows }: { readonly rows: KeywordVisibilityRow[] }) {
  const [sortKey, setSortKey] = useState<KeywordSortKey>('first_party_score');
  const [descending, setDescending] = useState(true);

  const toggleSort = (key: KeywordSortKey) => {
    if (key === sortKey) {
      setDescending((previous) => !previous);
    } else {
      setSortKey(key);
      setDescending(key !== 'keyword' && key !== 'first_party_best_rank');
    }
  };

  const withData = sortRows(rows.filter((row) => row.has_data), sortKey, descending);
  const withoutData = rows.filter((row) => !row.has_data);

  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-lg font-medium">Keywords in this scope</h3>
      </div>
      <div className="overflow-x-auto">
        <table aria-label="Keywords in this scope" className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {KEYWORD_COLUMNS.map((column) => (
                <th key={column.key} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                  <button type="button" onClick={() => toggleSort(column.key)} className="hover:text-gray-900" aria-sort={sortDirection(sortKey === column.key, descending)}>
                    {column.label}{sortKey === column.key && (descending ? ' ↓' : ' ↑')}
                  </button>
                </th>
              ))}
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mentions you</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {withData.map((row) => <KeywordRow key={row.keyword} row={row} />)}
            {withoutData.map((row) => (
              <tr key={row.keyword} className="bg-gray-50 text-gray-400">
                <td className="px-4 py-3 text-sm">{row.keyword}</td>
                <td className="px-4 py-3 text-sm" colSpan={6}>No analysis data yet</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No keywords in this scope.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KeywordRow({ row }: { readonly row: KeywordVisibilityRow }) {
  return (
    <tr>
      <td className="px-4 py-3 text-sm font-medium text-gray-900">{row.keyword}</td>
      <td className="px-4 py-3 text-sm font-bold text-gray-900">{row.first_party_score}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{row.competitor_score}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{row.first_party_sov}%</td>
      <td className="px-4 py-3 text-sm text-gray-600">{formatRank(row.first_party_best_rank)}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{row.total_mentions}</td>
      <td className="px-4 py-3 text-sm">
        <span className={`px-2 py-0.5 rounded text-xs ${row.first_party_mentioned ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'}`}>
          {row.first_party_mentioned ? 'yes' : 'no'}
        </span>
      </td>
    </tr>
  );
}

function GroupBrandTable({ brands }: { readonly brands: GroupBrandVisibilityMetric[] }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-200">
        <h3 className="text-lg font-medium">Brand Rankings across the scope</h3>
        <p className="text-xs text-gray-500 mt-0.5">Score is the brand&apos;s mean visibility over the keywords it appears on.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Brand</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Score</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Keywords</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Share of Voice</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Mentions</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Providers</th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200">
            {brands.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">No brand data available.</td></tr>
            )}
            {brands.map((brand) => (
              <tr key={brand.name}>
                <td className="px-4 py-3 text-sm font-medium text-gray-900">{brand.name}</td>
                <td className="px-4 py-3 text-sm font-bold text-gray-900">{brand.visibility_score}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{brand.keyword_count}</td>
                <td className="px-4 py-3 text-sm text-gray-600">{brand.share_of_voice}%</td>
                <td className="px-4 py-3 text-sm text-gray-600">{brand.total_mentions}</td>
                <td className="px-4 py-3 text-sm">
                  <div className="flex flex-wrap gap-1">
                    {brand.providers.map((provider) => (
                      <span key={provider} className="px-2 py-0.5 bg-blue-100 text-blue-800 rounded text-xs">{provider}</span>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3 text-sm">
                  <span className={`px-2 py-1 rounded text-xs ${classBadge(brand.classification)}`}>{brand.classification.replace('_', ' ')}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function classBadge(classification: string): string {
  if (classification === 'first_party') return 'bg-green-100 text-green-800';
  if (classification === 'competitor') return 'bg-red-100 text-red-800';
  return 'bg-gray-100 text-gray-800';
}
