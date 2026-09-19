import {
  exportWorkbook, type ExcelSheet
} from '../../exporters/excelGenerator';
import type {
  GroupVisibilityResponse, HistoricalTrendsResponse
} from '../../types';

const UNRANKED_SENTINEL = 999;

function isExportableRank(rank: number | null | undefined): rank is number {
  return rank !== null
    && rank !== undefined
    && Number.isFinite(rank)
    && rank >= 1
    && rank < UNRANKED_SENTINEL;
}

function isExportableNumber(value: number | null | undefined): value is number {
  return value !== null && value !== undefined && Number.isFinite(value);
}

/** Excel export of group visibility, prominence, keyword detail and history. */
export function groupOverviewSheets(
  visibility: GroupVisibilityResponse,
  trends: HistoricalTrendsResponse | null,
  scopeLabel: string
): ExcelSheet[] {
  const summary = visibility.summary;
  const sheets: ExcelSheet[] = [
    {
      name: 'Summary',
      columns: [{ wch: 40 }, { wch: 18 }],
      data: [
        {
          Metric: 'Scope',
          Value: scopeLabel
        },
        {
          Metric: 'Latest run',
          Value: visibility.timestamp ?? ''
        },
        {
          Metric: 'Keywords analysed',
          Value: visibility.keywords_analyzed
        },
        {
          Metric: 'Keywords with data',
          Value: visibility.keywords_with_data
        },
        {
          Metric: 'Your visibility (avg)',
          Value: summary.first_party_avg_score
        },
        {
          Metric: 'Competitor visibility (avg)',
          Value: summary.competitor_avg_score
        },
        {
          Metric: 'Your share of voice (avg %)',
          Value: summary.first_party_avg_sov
        },
        {
          Metric: 'Competitor share of voice (avg %)',
          Value: summary.competitor_avg_sov
        },
        {
          Metric: 'Citation rate (% keywords mentioning you)',
          Value: summary.coverage_rate
        },
        {
          Metric: 'Provider coverage (%)',
          Value: summary.provider_coverage
        },
        {
          Metric: 'First-party mean best rank',
          Value: isExportableRank(summary.first_party_mean_best_rank) ? summary.first_party_mean_best_rank : ''
        },
        {
          Metric: 'Prominence: rank #1 share (% answers)',
          Value: summary.rank_1_share
        },
        {
          Metric: 'Prominence: top-3 share (% answers)',
          Value: summary.top_3_share
        },
        {
          Metric: 'Prominence: mean rank',
          Value: isExportableRank(summary.mean_rank) ? summary.mean_rank : ''
        },
        {
          Metric: 'Prominence: mean first position',
          Value: isExportableNumber(summary.mean_first_position) ? summary.mean_first_position : ''
        },
      ],
    },
    {
      name: 'Keywords',
      columns: [
        { wch: 40 },
        { wch: 10 },
        { wch: 14 },
        { wch: 18 },
        { wch: 16 },
        { wch: 12 },
        { wch: 22 },
        { wch: 12 },
        { wch: 10 },
        { wch: 18 },
        { wch: 16 },
        { wch: 16 },
        { wch: 12 },
        { wch: 20 },
      ],
      data: visibility.keywords.map((row) => ({
        Keyword: row.keyword,
        'Has data': row.has_data ? 'yes' : 'no',
        'Your score': row.first_party_score,
        'Competitor score': row.competitor_score,
        'Your SoV %': row.first_party_sov,
        Mentions: row.total_mentions,
        'Providers mentioning you': row.first_party_providers,
        'Best rank': isExportableRank(row.first_party_best_rank) ? row.first_party_best_rank : '',
        Answers: row.answers,
        'Mentioned answers': row.mentioned_answers,
        'Rank #1 share %': row.rank_1_share,
        'Top-3 share %': row.top_3_share,
        'Mean rank': isExportableRank(row.mean_rank) ? row.mean_rank : '',
        'Mean first position': isExportableNumber(row.mean_first_position) ? row.mean_first_position : '',
      })),
    },
    {
      name: 'Brands',
      columns: [{ wch: 30 }, { wch: 14 }, { wch: 10 }, { wch: 10 }, { wch: 12 }, { wch: 10 }, { wch: 10 }, { wch: 30 }],
      data: visibility.brands.map((brand) => ({
        Brand: brand.name,
        Type: brand.classification,
        Score: brand.visibility_score,
        'SoV %': brand.share_of_voice,
        Keywords: brand.keyword_count,
        Mentions: brand.total_mentions,
        'Best rank': isExportableRank(brand.best_rank) ? brand.best_rank : '',
        Providers: brand.providers.join(', '),
      })),
    },
  ];

  if (trends && trends.trend_data.length > 0) {
    sheets.push({
      name: 'History',
      columns: [
        { wch: 14 },
        { wch: 16 },
        { wch: 12 },
        { wch: 12 },
        { wch: 14 },
        { wch: 12 },
        { wch: 10 },
        { wch: 18 },
        { wch: 16 },
        { wch: 16 },
        { wch: 12 },
        { wch: 20 },
      ],
      data: trends.trend_data.map((point) => ({
        Period: point.period,
        'Visibility score': point.visibility_score,
        Mentions: point.total_mentions,
        Providers: point.provider_count,
        'Analysis runs': point.analysis_runs,
        'Best rank': isExportableRank(point.best_rank) ? point.best_rank : '',
        Answers: point.answers ?? '',
        'Mentioned answers': point.mentioned_answers ?? '',
        'Rank #1 share %': point.rank_1_share ?? '',
        'Top-3 share %': point.top_3_share ?? '',
        'Mean rank': isExportableRank(point.mean_rank) ? point.mean_rank : '',
        'Mean first position': isExportableNumber(point.mean_first_position) ? point.mean_first_position : '',
      })),
    });
  }

  return sheets;
}

export function groupOverviewFileName(scopeLabel: string, date = new Date()): string {
  const slug = scopeLabel.toLowerCase().replaceAll(/[^a-z0-9]+/g, '-').replaceAll(/^-|-$/g, '') || 'keywords';
  return `visibility-${slug}-${date.toISOString().slice(0, 10)}.xlsx`;
}

export async function exportGroupOverview(
  visibility: GroupVisibilityResponse,
  trends: HistoricalTrendsResponse | null,
  scopeLabel: string
): Promise<void> {
  await exportWorkbook(groupOverviewSheets(visibility, trends, scopeLabel), groupOverviewFileName(scopeLabel));
}
