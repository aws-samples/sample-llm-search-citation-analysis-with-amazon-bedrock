import type { Search } from '../types';

/** One OpenAI answer for the Altiplano Air route question, with two citations. */
export function buildSearch(overrides: Partial<Search> = {}): Search {
  return {
    keyword: 'altiplano air flights to cusco',
    provider: 'openai',
    timestamp: '2026-03-10T09:00:00Z',
    citations: ['https://altiplano-air.example/routes', 'https://condor-sur.example/compare'],
    ...overrides,
  };
}

export const OLDEST = buildSearch({
  provider: 'gemini',
  timestamp: '2026-03-08T09:00:00Z',
  citations: ['https://sky-andes.example/'],
});

export const MIDDLE = buildSearch({
  provider: 'perplexity',
  timestamp: '2026-03-09T09:00:00Z',
  citations: [],
});

export const NEWEST = buildSearch({ timestamp: '2026-03-10T09:00:00Z' });

/** The three runs with the newest one buried in the middle of the list. */
export const UNSORTED_RUNS: Search[] = [MIDDLE, NEWEST, OLDEST];
