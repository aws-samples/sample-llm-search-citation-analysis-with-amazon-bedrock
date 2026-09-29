import {
  render, screen
} from '@testing-library/react';
import type {
  AggregatedBrand, BrandAppearance, BrandMentionsResponse
} from '../../../../types';
import { mockBrandMentionsResponse } from '../../../../hooks/useBrandMentions-fixtures';
import { SentimentExamplesSection } from './SentimentExamplesSection';

/** A negative OpenAI appearance with a quote, a reason and a ranking context, unless overridden. */
export function buildAppearance(overrides: Partial<BrandAppearance> = {}): BrandAppearance {
  return {
    keyword: 'hotel coruna spa',
    provider: 'openai',
    model: 'gpt-5-mini',
    rank: 3,
    mention_count: 1,
    first_position: 120,
    sentiment: 'negative',
    sentiment_quote: 'Guests often mention that the rooms feel dated.',
    sentiment_reason: 'The answer warns about dated rooms.',
    ranking_context: 'a cheaper but dated option',
    ...overrides,
  };
}

function firstPartyBrand(name: string, appearances: BrandAppearance[]): AggregatedBrand {
  return {
    name,
    parent_company: null,
    provider_count: 1,
    total_mentions: appearances.length,
    best_rank: 1,
    overall_rank: 1,
    aggregate_score: 0.5,
    classification: 'first_party',
    providers: ['openai'],
    appearances,
  };
}

/** `/brand-mentions` whose first-party brands are `brands` (name to appearances), in order. */
export function mentionsOf(brands: Record<string, BrandAppearance[]>): BrandMentionsResponse {
  return {
    ...mockBrandMentionsResponse,
    aggregated: {
      ...mockBrandMentionsResponse.aggregated,
      first_party_brands: Object.entries(brands).map(([name, appearances]) => firstPartyBrand(name, appearances)),
    },
  };
}

/** The section once `mentions` settled. */
export function renderExamples(mentions: BrandMentionsResponse | null) {
  return render(<SentimentExamplesSection mentions={mentions} loading={false} error={null} />);
}

/** Every "Why: …" line shown, in order. */
export function reasonLines(): Array<string | undefined> {
  return screen.getAllByText(/^Why: /).map((line) => line.textContent?.trim());
}
