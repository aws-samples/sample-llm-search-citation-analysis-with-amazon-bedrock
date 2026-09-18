import type {
  KeywordResearchItem, ResearchKeyword, ResearchTemplate
} from '../../../types';

export function buildAgentKeyword(overrides: Partial<ResearchKeyword> = {}): ResearchKeyword {
  return {
    keyword: 'hotel coruña centro',
    intent: 'transactional',
    competition: 'high',
    relevance: 9,
    dimension: 'destination',
    rationale: 'core demand',
    providers: ['perplexity'],
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
    proposal_source: 'model',
    created_at: '2026-09-18T10:00:00Z',
    finished_at: '2026-09-18T10:06:00Z',
    round: 2,
    steps_total: 4,
    steps_done: 4,
    steps_failed: 0,
    config: {
      seed: 'Hotel Gran Marino',
      country: 'es',
      language: 'es',
      dimensions: ['destination', 'audience'],
      instruction: '',
      target_count: 60,
      max_rounds: 2,
      group_id: 'g1',
    },
    template_id: 'builtin-default',
    template_name: 'Hotel keyword research (default)',
    system_prompt: 'You are a hotel SEO researcher.',
    rounds: [
      {
        round: 1,
        planned_at: '2026-09-18T10:00:10Z',
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
        step_ids: ['r1-q1-perplexity', 'r1-q2-openai'],
        evaluation: {
          assessment: 'Audience is thin',
          decision: 'continue',
          reason: 'more to find',
          next_queries: [{
            query: 'hotel coruña con niños',
            dimension: 'audience',
            rationale: '',
          }],
          candidate_count: 30,
        },
      },
      {
        round: 2,
        planned_at: '2026-09-18T10:03:00Z',
        strategy: '',
        queries: [{
          query: 'hotel coruña con niños',
          dimension: 'audience',
          rationale: '',
        }],
        step_ids: ['r2-q1-perplexity'],
        evaluation: {
          assessment: '',
          decision: 'stop',
          reason: 'Reached the maximum of 2 rounds.',
          next_queries: [],
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
        providers: ['perplexity', 'serpapi'],
      }),
      buildAgentKeyword({
        keyword: 'escapada coruña',
        intent: 'informational',
        competition: 'low',
        relevance: 6,
        dimension: 'weather',
        rationale: '',
        providers: ['openai'],
      }),
    ],
    ...overrides,
  };
}

export function buildTemplate(overrides: Partial<ResearchTemplate> = {}): ResearchTemplate {
  return {
    id: 'builtin-default',
    name: 'Hotel keyword research (default)',
    description: 'Built-in starting point.',
    system_prompt: 'You are a hotel SEO researcher for a hotel group.',
    builtin: true,
    ...overrides,
  };
}
