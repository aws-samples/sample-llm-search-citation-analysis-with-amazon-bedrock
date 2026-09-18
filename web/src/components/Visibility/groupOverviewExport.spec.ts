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
  total_providers: 4,
  keywords_analyzed: 2,
  keywords_with_data: 1,
  keywords: [{
    keyword: 'hotel coruna spa',
    has_data: true,
    timestamp: '2026-09-18T10:00:00Z',
    first_party_score: 72.5,
    competitor_score: 40,
    first_party_sov: 55,
    competitor_sov: 45,
    first_party_providers: 3,
    total_mentions: 9,
    first_party_mentioned: true,
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
  },
};

const trends: HistoricalTrendsResponse = {
  period_type: 'day',
  days_analyzed: 30,
  data_points: 1,
  trend_data: [{
    period: '2026-09-18',
    visibility_score: 72.5,
    total_mentions: 9,
    provider_count: 3,
    best_rank: 1,
    analysis_runs: 1 
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
  it('builds summary, keywords, brands and history sheets', () => {
    const sheets = groupOverviewSheets(visibility, trends, 'Hotel Coruña');

    expect(sheets.map((sheet) => sheet.name)).toStrictEqual(['Summary', 'Keywords', 'Brands', 'History']);
  });

  it('puts the group KPIs on the summary sheet', () => {
    const [summary] = groupOverviewSheets(visibility, trends, 'Hotel Coruña');

    expect(summary.data).toContainEqual({
      Metric: 'Your visibility (avg)',
      Value: 72.5 
    });
    expect(summary.data).toContainEqual({
      Metric: 'Coverage (% keywords mentioning you)',
      Value: 100 
    });
    expect(summary.data[0]).toStrictEqual({
      Metric: 'Scope',
      Value: 'Hotel Coruña' 
    });
  });

  it('writes one keyword row with its scores', () => {
    const keywordsSheet = groupOverviewSheets(visibility, trends, 'x')[1];

    expect(keywordsSheet.data).toStrictEqual([{
      Keyword: 'hotel coruna spa',
      'Has data': 'yes',
      'Your score': 72.5,
      'Competitor score': 40,
      'Your SoV %': 55,
      Mentions: 9,
      'Providers mentioning you': 3,
    }]);
  });

  it('joins providers on the brands sheet', () => {
    const brandsSheet = groupOverviewSheets(visibility, trends, 'x')[2];

    expect(brandsSheet.data[0]).toMatchObject({
      Brand: 'Hotel Coruna',
      Providers: 'gemini, openai, perplexity',
      Keywords: 1 
    });
  });

  it('omits the history sheet when there are no trend points', () => {
    const sheets = groupOverviewSheets(visibility, null, 'x');

    expect(sheets.map((sheet) => sheet.name)).toStrictEqual(['Summary', 'Keywords', 'Brands']);
  });
});

describe('groupOverviewFileName', () => {
  it('slugs the scope label and dates the file', () => {
    expect(groupOverviewFileName('Hotel Coruña — weekly', new Date('2026-09-18T12:00:00Z'))).toBe('visibility-hotel-coru-a-weekly-2026-09-18.xlsx');
  });

  it('falls back to keywords for an empty label', () => {
    expect(groupOverviewFileName('', new Date('2026-09-18T12:00:00Z'))).toBe('visibility-keywords-2026-09-18.xlsx');
  });
});
