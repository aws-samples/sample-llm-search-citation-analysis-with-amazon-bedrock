import {
  describe, it, expect
} from 'vitest';
import {
  groupOverviewFileName, groupOverviewSheets
} from './groupOverviewExport';
import type {
  GroupVisibilityResponse, HistoricalTrendsResponse
} from '../../types';

const visibility: GroupVisibilityResponse = {
  scope: {
    kind: 'group',
    label: '1 group(s)',
    keyword_count: 2
  },
  timestamp: '2026-09-18T10:00:00Z',
  keywords_analyzed: 2,
  keywords_with_data: 1,
  keywords: [{
    keyword: 'hotel coruna spa',
    has_data: true,
    timestamp: '2026-09-18T10:00:00Z',
    first_party_score: 72.5,
    competitor_score: 40,
    first_party_sov: 55,
    first_party_providers: 3,
    total_mentions: 9,
    first_party_mentioned: true,
    first_party_best_rank: 1,
    answers: 4,
    mentioned_answers: 3,
    rank_1_share: 50,
    top_3_share: 75,
    mean_rank: 2.5,
    mean_first_position: 24,
  }],
  brands: [{
    name: 'Hotel Coruna',
    classification: 'first_party',
    visibility_score: 72.5,
    share_of_voice: 55,
    provider_count: 3,
    providers: ['gemini', 'openai', 'perplexity'],
    total_mentions: 9,
    best_rank: 1,
    keyword_count: 1,
  }],
  first_party: [],
  competitors: [],
  others: [],
  summary: {
    first_party_avg_score: 72.5,
    competitor_avg_score: 40,
    first_party_avg_sov: 55,
    competitor_avg_sov: 45,
    coverage_rate: 100,
    provider_coverage: 75,
    first_party_mean_best_rank: 1.5,
    rank_1_share: 50,
    top_3_share: 75,
    mean_rank: 2.5,
    mean_first_position: 24,
  },
};

const trends: HistoricalTrendsResponse = {
  period_type: 'day',
  days_analyzed: 30,
  trend_data: [{
    period: '2026-09-18',
    visibility_score: 72.5,
    total_mentions: 9,
    provider_count: 3,
    best_rank: 1,
    analysis_runs: 1,
    answers: 4,
    mentioned_answers: 3,
    rank_1_share: 50,
    top_3_share: 75,
    mean_rank: 2.5,
    mean_first_position: 24,
  }],
  trend_direction: 'stable',
  summary: {
    current_score: 72.5,
    previous_score: 0,
    change: 0,
    change_percent: 0,
    average_score: 72.5,
    max_score: 72.5,
    min_score: 72.5
  },
};

describe('groupOverviewSheets', () => {
  it('builds summary keyword brand and history sheets when trends exist', () => {
    const sheets = groupOverviewSheets(visibility, trends, 'Hotel Coruña');

    expect(sheets.map((sheet) => sheet.name)).toStrictEqual(['Summary', 'Keywords', 'Brands', 'History']);
  });

  it('exports Citation rate and prominence in the summary sheet', () => {
    const [summary] = groupOverviewSheets(visibility, trends, 'Hotel Coruña');

    expect(summary.data).toStrictEqual([
      {
        Metric: 'Scope',
        Value: 'Hotel Coruña'
      },
      {
        Metric: 'Latest run',
        Value: '2026-09-18T10:00:00Z'
      },
      {
        Metric: 'Keywords analysed',
        Value: 2
      },
      {
        Metric: 'Keywords with data',
        Value: 1
      },
      {
        Metric: 'Your visibility (avg)',
        Value: 72.5
      },
      {
        Metric: 'Competitor visibility (avg)',
        Value: 40
      },
      {
        Metric: 'Your share of voice (avg %)',
        Value: 55
      },
      {
        Metric: 'Competitor share of voice (avg %)',
        Value: 45
      },
      {
        Metric: 'Citation rate (% keywords mentioning you)',
        Value: 100
      },
      {
        Metric: 'Provider coverage (%)',
        Value: 75
      },
      {
        Metric: 'First-party mean best rank',
        Value: 1.5
      },
      {
        Metric: 'Prominence: rank #1 share (% answers)',
        Value: 50
      },
      {
        Metric: 'Prominence: top-3 share (% answers)',
        Value: 75
      },
      {
        Metric: 'Prominence: mean rank',
        Value: 2.5
      },
      {
        Metric: 'Prominence: mean first position',
        Value: 24
      },
    ]);
  });

  it('exports keyword prominence and best rank in the keyword sheet', () => {
    const keywordsSheet = groupOverviewSheets(visibility, trends, 'x')[1];

    expect(keywordsSheet.data).toStrictEqual([{
      Keyword: 'hotel coruna spa',
      'Has data': 'yes',
      'Your score': 72.5,
      'Competitor score': 40,
      'Your SoV %': 55,
      Mentions: 9,
      'Providers mentioning you': 3,
      'Best rank': 1,
      Answers: 4,
      'Mentioned answers': 3,
      'Rank #1 share %': 50,
      'Top-3 share %': 75,
      'Mean rank': 2.5,
      'Mean first position': 24,
    }]);
  });

  it('exports period prominence without removing historical best rank', () => {
    const historySheet = groupOverviewSheets(visibility, trends, 'x')[3];

    expect(historySheet.data).toStrictEqual([{
      Period: '2026-09-18',
      'Visibility score': 72.5,
      Mentions: 9,
      Providers: 3,
      'Analysis runs': 1,
      'Best rank': 1,
      Answers: 4,
      'Mentioned answers': 3,
      'Rank #1 share %': 50,
      'Top-3 share %': 75,
      'Mean rank': 2.5,
      'Mean first position': 24,
    }]);
  });

  it('exports provider names as one deterministic brand value', () => {
    const brandsSheet = groupOverviewSheets(visibility, trends, 'x')[2];

    expect(brandsSheet.data).toStrictEqual([{
      Brand: 'Hotel Coruna',
      Type: 'first_party',
      Score: 72.5,
      'SoV %': 55,
      Keywords: 1,
      Mentions: 9,
      'Best rank': 1,
      Providers: 'gemini, openai, perplexity',
    }]);
  });

  it('exports sentinel ranks as unavailable values', () => {
    const sentinelVisibility = {
      ...visibility,
      keywords: [{
        ...visibility.keywords[0],
        first_party_best_rank: 999,
        mean_rank: 999,
      }],
      brands: [{
        ...visibility.brands[0],
        best_rank: 999,
      }],
      summary: {
        ...visibility.summary,
        first_party_mean_best_rank: 999,
        mean_rank: 999,
      },
    } satisfies GroupVisibilityResponse;

    const sheets = groupOverviewSheets(sentinelVisibility, null, 'x');

    expect(sheets[0].data[10].Value).toBe('');
    expect(sheets[0].data[13].Value).toBe('');
    expect(sheets[1].data[0]).toStrictEqual({
      ...groupOverviewSheets(visibility, null, 'x')[1].data[0],
      'Best rank': '',
      'Mean rank': '',
    });
    expect(sheets[2].data[0]).toStrictEqual({
      ...groupOverviewSheets(visibility, null, 'x')[2].data[0],
      'Best rank': '',
    });
  });

  it('omits history sheet when trend points are unavailable', () => {
    const sheets = groupOverviewSheets(visibility, null, 'x');

    expect(sheets.map((sheet) => sheet.name)).toStrictEqual(['Summary', 'Keywords', 'Brands']);
  });

  it('sizes the seven prominence columns identically in the keyword and history sheets', () => {
    const [, keywordsSheet, , historySheet] = groupOverviewSheets(visibility, trends, 'x');
    const prominenceWidths = [{ wch: 12 }, { wch: 10 }, { wch: 18 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 20 }];

    expect(keywordsSheet.columns.slice(-prominenceWidths.length)).toStrictEqual(prominenceWidths);
    expect(historySheet.columns.slice(-prominenceWidths.length)).toStrictEqual(prominenceWidths);
  });

  it.each([
    ['Summary', 0, 2],
    ['Keywords', 1, 14],
    ['Brands', 2, 8],
    ['History', 3, 12],
  ])('defines one column width per exported field in the %s sheet', (_sheetName, sheetIndex, fieldCount) => {
    const sheet = groupOverviewSheets(visibility, trends, 'x')[sheetIndex];

    expect(Object.keys(sheet.data[0])).toHaveLength(fieldCount);
    expect(sheet.columns).toHaveLength(fieldCount);
  });
});

describe('groupOverviewFileName', () => {
  it('slugs the scope label and dates the file', () => {
    expect(groupOverviewFileName('Hotel Coruña — weekly', new Date('2026-09-18T12:00:00Z'))).toBe('visibility-hotel-coru-a-weekly-2026-09-18.xlsx');
  });

  it('falls back to keywords when scope label has no slug characters', () => {
    expect(groupOverviewFileName('', new Date('2026-09-18T12:00:00Z'))).toBe('visibility-keywords-2026-09-18.xlsx');
  });
});
