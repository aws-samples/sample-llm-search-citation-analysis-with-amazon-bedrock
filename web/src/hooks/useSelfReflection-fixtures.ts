import type { SelfReflectionResult } from '../types';

/** One stored self-reflection: why Hotel Sol ranks second for the family persona. */
export const mockSelfReflection: SelfReflectionResult = {
  keyword: 'hotels in madrid',
  brand: 'Hotel Sol',
  query_prompt_id: 'prompt-family',
  query_prompt_name: 'Family traveller',
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
  industry: 'hospitality',
  created_at: '2026-03-01T10:00:00Z',
};
