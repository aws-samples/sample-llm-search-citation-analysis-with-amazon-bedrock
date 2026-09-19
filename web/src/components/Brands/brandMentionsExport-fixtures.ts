import {
  fireEvent, screen
} from '@testing-library/react';
import type {
  BrandMentionsResponse, Keyword, ReportScope
} from '../../types';

export const LATEST_BRAND_RUN = '2026-09-18T10:00:00Z';
export const HISTORICAL_BRAND_RUN = '2026-09-10T10:00:00Z';
export const KEYWORD_SCOPE_VALUE = 'keyword:hotels';
export const GROUP_SCOPE_VALUE = 'group:group-coruna';

export const KEYWORD_REPORT_SCOPE = {
  kind: 'keyword',
  keyword: 'hotels',
} satisfies ReportScope;

export const GROUP_REPORT_SCOPE = {
  kind: 'group',
  groupId: 'group-coruna',
} satisfies ReportScope;

export function selectBrandScope(value = KEYWORD_SCOPE_VALUE): void {
  fireEvent.change(screen.getByLabelText('Scope'), { target: { value } });
}

export function selectBrandRun(value = HISTORICAL_BRAND_RUN): void {
  fireEvent.change(screen.getByLabelText('Analysis run'), { target: { value } });
}

export const brandKeywordsFixture: Keyword[] = [{
  id: '1',
  keyword: 'hotels',
  created_at: '2024-01-01',
}];

export const brandMentionsExportResponse: BrandMentionsResponse = {
  keyword: null,
  timestamp: LATEST_BRAND_RUN,
  available_runs: [LATEST_BRAND_RUN, HISTORICAL_BRAND_RUN],
  scope: {
    kind: 'group',
    label: '1 group(s)',
    keyword_count: 2,
  },
  keywords_analyzed: 2,
  keywords_with_data: 1,
  config: null,
  by_provider: [],
  aggregated: {
    brands: [
      {
        name: 'Hotel Coruna',
        parent_company: null,
        provider_count: 2,
        total_mentions: 3,
        best_rank: 1,
        overall_rank: 1,
        aggregate_score: 22,
        classification: 'first_party',
        providers: ['openai', 'gemini'],
        keyword_count: 2,
        keywords: ['best hotels galicia', 'hotel coruna spa'],
        appearances: [
          {
            keyword: 'hotel coruna spa',
            provider: 'openai',
            model: 'gpt-4.1',
            rank: 1,
            mention_count: 2,
            first_position: 12,
            sentiment: 'positive',
          },
          {
            keyword: 'best hotels galicia',
            provider: 'gemini',
            model: 'gemini-2.5-pro',
            rank: 2,
            mention_count: 1,
            first_position: 30,
            sentiment: 'neutral',
          },
        ],
      },
      {
        name: 'Rival Inn',
        parent_company: null,
        provider_count: 1,
        total_mentions: 4,
        best_rank: 3,
        overall_rank: 2,
        aggregate_score: 21,
        classification: 'competitor',
        providers: ['openai'],
        keyword_count: 1,
        keywords: ['hotel coruna spa'],
        appearances: [{
          keyword: 'hotel coruna spa',
          provider: 'openai',
          model: 'gpt-4.1',
          rank: 3,
          mention_count: 4,
          first_position: 44,
          sentiment: 'negative',
        }],
      },
    ],
    total_unique_brands: 2,
    first_party_brands: [],
    competitor_brands: [],
    summary: {
      first_party_count: 1,
      competitor_count: 1,
      other_count: 0,
    },
  },
};
