import type {
  AgentConfig, AgentDimensionOption, Keyword, KeywordResearchItem, ResearchKeyword, ResearchTemplate
} from '../../../types';

/** The hotels catalogue the built-in default template ships (and legacy runs are backfilled with). */
export const HOTEL_DIMENSIONS: AgentDimensionOption[] = [
  {
    id: 'destination',
    label: 'Destination',
    description: 'the city or region as a place to stay',
  },
  {
    id: 'location',
    label: 'Location / neighbourhood',
    description: '"hotel near …", landmarks and areas around the hotel',
  },
  {
    id: 'points_of_interest',
    label: 'Points of interest',
    description: 'attractions, venues and events people travel for',
  },
  {
    id: 'hotel_attributes',
    label: 'Hotel attributes',
    description: 'pool, spa, parking, pet friendly, sea view, breakfast…',
  },
  {
    id: 'audience',
    label: 'Audience',
    description: 'families, couples, business travellers, groups, solo',
  },
  {
    id: 'trip_type',
    label: 'Trip type',
    description: 'weekend break, honeymoon, conference, golf, beach holiday',
  },
];

export const CAFE_DIMENSIONS: AgentDimensionOption[] = [
  {
    id: 'menu',
    label: 'Menu & drinks',
    description: 'specialty coffee, brunch, pastries, vegan options',
  },
  {
    id: 'location',
    label: 'Location',
    description: '"café near …", neighbourhoods and landmarks',
  },
  {
    id: 'occasion',
    label: 'Occasion',
    description: 'work-friendly, first date, with kids, late night',
  },
];

export const promotedActiveKeywordFixture = {
  id: 'k1',
  keyword: 'hotel coruña centro',
  status: 'active',
  created_at: '2026-09-18T10:07:00Z',
} satisfies Keyword;

export const promotedInactiveKeywordFixture = {
  id: 'k2',
  keyword: 'escapada coruña',
  status: 'inactive',
  created_at: '2026-09-18T10:07:00Z',
} satisfies Keyword;

export const selectedPromotionResponseFixture = {
  created: 1,
  skipped: 0,
  created_keywords: [promotedActiveKeywordFixture],
  skipped_keywords: [],
};

export const fullPromotionResponseFixture = {
  created: 2,
  skipped: 0,
  created_keywords: [promotedActiveKeywordFixture, promotedInactiveKeywordFixture],
  skipped_keywords: [],
};

export function buildAgentKeyword(overrides: Partial<ResearchKeyword> = {}): ResearchKeyword {
  return {
    keyword: 'hotel coruña centro',
    intent: 'transactional',
    competition: 'high',
    relevance: 9,
    dimension: 'destination',
    rationale: 'core demand',
    tracking: true,
    tracking_score: 904,
    tracking_reason: 'Relevance 9/10; transactional intent; 1 provider.',
    providers: ['perplexity'],
    ...overrides,
  };
}

export function buildAgentConfig(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    seed: 'Hotel Gran Marino',
    country: 'es',
    language: 'es',
    dimensions: ['destination', 'audience'],
    instruction: '',
    target_count: 60,
    tracking_count: 2,
    max_rounds: 2,
    group_id: 'g1',
    subject: 'hotel',
    audience: 'travellers',
    dimension_catalog: HOTEL_DIMENSIONS,
    ...overrides,
  };
}

/** A finished agent run with two rounds and a three-keyword proposal. */
export function buildAgentJob(overrides: Partial<KeywordResearchItem> = {}): KeywordResearchItem {
  return {
    id: 'job-a',
    type: 'agent',
    seed_keyword: 'Hotel Gran Marino',
    industry: 'general',
    status: 'completed',
    keyword_count: 3,
    candidates_count: 41,
    tracking_count: 2,
    proposal_source: 'model',
    created_at: '2026-09-18T10:00:00Z',
    finished_at: '2026-09-18T10:06:00Z',
    round: 2,
    steps_total: 4,
    steps_done: 4,
    steps_failed: 0,
    config: buildAgentConfig(),
    template_id: 'builtin-default',
    template_name: 'Hotels',
    system_prompt: 'You are a hotel SEO researcher.',
    rounds: [
      {
        round: 1,
        strategy: 'Destination first',
        queries: [
          {
            query: 'hoteles coruña centro',
            dimension: 'destination',
            rationale: 'core',
          },
          {
            query: 'hotel familiar coruña',
            dimension: 'audience',
            rationale: 'families',
          },
        ],
        evaluation: {
          assessment: 'Audience is thin',
          decision: 'continue',
          reason: 'more to find',
          candidate_count: 30,
        },
      },
      {
        round: 2,
        strategy: '',
        queries: [{
          query: 'hotel coruña con niños',
          dimension: 'audience',
          rationale: '',
        }],
        evaluation: {
          assessment: '',
          decision: 'stop',
          reason: 'Reached the maximum of 2 rounds.',
          candidate_count: 41,
        },
      },
    ],
    steps: [
      {
        step_id: 'r1-q1-perplexity',
        provider: 'perplexity',
        status: 'completed',
        keyword_count: 14,
        round: 1,
        query: 'hoteles coruña centro',
        dimension: 'destination',
      },
      {
        step_id: 'r1-q2-openai',
        provider: 'openai',
        status: 'completed',
        keyword_count: 12,
        round: 1,
        query: 'hotel familiar coruña',
        dimension: 'audience',
      },
      {
        step_id: 'r1-signals-serpapi',
        provider: 'serpapi',
        status: 'completed',
        keyword_count: 9,
        round: 1,
        query_count: 2,
      },
      {
        step_id: 'r2-q1-perplexity',
        provider: 'perplexity',
        status: 'completed',
        keyword_count: 11,
        round: 2,
        query: 'hotel coruña con niños',
        dimension: 'audience',
      },
    ],
    keywords: [
      buildAgentKeyword(),
      buildAgentKeyword({
        keyword: 'hotel coruña con niños',
        intent: 'commercial',
        competition: 'medium',
        relevance: 8,
        dimension: 'audience',
        rationale: 'family demand',
        tracking_score: 805,
        tracking_reason: 'Relevance 8/10; commercial intent; 2-provider agreement; Google suggestion signals.',
        providers: ['perplexity', 'serpapi'],
      }),
      buildAgentKeyword({
        keyword: 'escapada coruña',
        intent: 'informational',
        competition: 'low',
        relevance: 6,
        dimension: 'weather',
        rationale: '',
        tracking: false,
        tracking_score: 602,
        tracking_reason: 'Relevance 6/10; informational intent; 1 provider.',
        providers: ['openai'],
      }),
    ],
    ...overrides,
  };
}

/** The built-in hotels template (`builtin-default`). */
export function buildTemplate(overrides: Partial<ResearchTemplate> = {}): ResearchTemplate {
  return {
    id: 'builtin-default',
    name: 'Hotels',
    description: 'Built-in starting point for hotels and resorts.',
    industry: 'hotels',
    subject: 'hotel',
    audience: 'travellers',
    dimensions: HOTEL_DIMENSIONS,
    system_prompt: 'You are a hotel SEO researcher for a hotel group.',
    builtin: true,
    ...overrides,
  };
}

/** The built-in cafés template — a different subject, audience and catalogue. */
export function buildCafeTemplate(overrides: Partial<ResearchTemplate> = {}): ResearchTemplate {
  return buildTemplate({
    id: 'builtin-cafes',
    name: 'Cafés',
    description: 'Built-in starting point for cafés and coffee shops.',
    industry: 'cafes',
    subject: 'café',
    audience: 'coffee drinkers',
    dimensions: CAFE_DIMENSIONS,
    system_prompt: 'You are an SEO researcher for independent cafés.',
    ...overrides,
  });
}

/** A template the team saved from the hotels built-in. */
export function buildSavedTemplate(overrides: Partial<ResearchTemplate> = {}): ResearchTemplate {
  return buildTemplate({
    id: 't1',
    name: 'Urban hotels',
    description: 'City hotels for business travellers.',
    system_prompt: 'You research urban hotels for business travellers.',
    builtin: false,
    created_by: 'ana',
    created_at: '2026-09-17T09:00:00Z',
    updated_at: '2026-09-17T09:00:00Z',
    ...overrides,
  });
}
