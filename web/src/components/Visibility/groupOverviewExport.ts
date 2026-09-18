import {
  exportWorkbook, type ExcelSheet 
} from '../../exporters/excelGenerator';
import type {
  GroupVisibilityResponse, HistoricalTrendsResponse 
} from '../../types';

/**
 * Excel export of a group overview: the KPI summary, the per-keyword table,
 * the cross-keyword brand ranking and the history series, one sheet each.
 */

export function groupOverviewSheets(
  visibility: GroupVisibilityResponse,
  trends: HistoricalTrendsResponse | null,
  scopeLabel: string
): ExcelSheet[] {
  const summary = visibility.summary;
  const sheets: ExcelSheet[] = [
    {
      name: 'Summary',
      columns: [{ wch: 34 }, { wch: 18 }],
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
          Metric: 'Coverage (% keywords mentioning you)',
          Value: summary.coverage_rate 
        },
        {
          Metric: 'Provider coverage (%)',
          Value: summary.provider_coverage 
        },
      ],
    },
    {
      name: 'Keywords',
      columns: [{ wch: 40 }, { wch: 10 }, { wch: 14 }, { wch: 18 }, { wch: 16 }, { wch: 12 }, { wch: 22 }],
      data: visibility.keywords.map((row) => ({
        Keyword: row.keyword,
        'Has data': row.has_data ? 'yes' : 'no',
        'Your score': row.first_party_score,
        'Competitor score': row.competitor_score,
        'Your SoV %': row.first_party_sov,
        Mentions: row.total_mentions,
        'Providers mentioning you': row.first_party_providers,
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
        'Best rank': brand.best_rank ?? '',
        Providers: brand.providers.join(', '),
      })),
    },
  ];

  if (trends && trends.trend_data.length > 0) {
    sheets.push({
      name: 'History',
      columns: [{ wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }, { wch: 14 }],
      data: trends.trend_data.map((point) => ({
        Period: point.period,
        'Visibility score': point.visibility_score,
        Mentions: point.total_mentions,
        Providers: point.provider_count,
        'Analysis runs': point.analysis_runs,
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
