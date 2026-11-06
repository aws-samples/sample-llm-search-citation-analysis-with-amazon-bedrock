import type { SelfReflectionResult } from '../types';

/** One stored self-reflection: why Hotel Sol ranks second for the family persona. */
export const mockSelfReflection: SelfReflectionResult = {
  keyword: 'hotels in madrid',
  brand: 'Hotel Sol',
  current_rank: 2,
  explanation: 'Hotel Sol is cited for its family rooms but not its pool.',
  content_contributions: 'Family room pages',
  competitor_advantages: 'Competitors publish pool and kids club guides',
  missing_data_points: 'Pool opening hours',
  recommendations: [{
    title: 'Publish a pool guide',
    description: 'Describe the pool, its hours and the kids club.',
    priority: 'high',
    content_type: 'guide',
  }],
};

/** `POST /self-reflection` answering 202 for the reflection above. */
export const pendingSelfReflection = {
  status: 'pending',
  keyword: 'hotels in madrid',
  brand: 'Hotel Sol',
  query_prompt_id: 'prompt-family',
};

/** The URL the hook checks a running analysis at. */
export const SELF_REFLECTION_STATUS_URL = 'https://api.test.com/self-reflection?keyword=hotels+in+madrid&brand=Hotel+Sol&query_prompt_id=prompt-family';

/** `GET /self-reflection` while the analysis runs. */
export const runningSelfReflection = {
  keyword: 'hotels in madrid',
  results: [],
  count: 0,
  job: {
    status: 'pending',
    started_at: '2026-11-05T12:00:00.000000Z' 
  },
};

/** `GET /self-reflection` once the analysis stored its reflection. */
export const finishedSelfReflection = {
  keyword: 'hotels in madrid',
  results: [mockSelfReflection],
  count: 1,
  job: null,
};

/** `GET /self-reflection` after the model ran out of time. */
export const failedSelfReflection = {
  keyword: 'hotels in madrid',
  results: [],
  count: 0,
  job: {
    status: 'failed',
    started_at: '2026-11-05T12:00:00.000000Z',
    error: 'The AI model did not answer in time; try again' 
  },
};
