import type { Recommendation } from '../../../../types';

/** A recommendation titled `title` whose description, action and impact name it. */
export function buildRec(
  title: string,
  priority: 'high' | 'medium' | 'low',
  overrides: Partial<Recommendation> = {},
): Recommendation {
  return {
    type: 'gap',
    priority,
    title,
    description: 'Description for ' + title,
    action: 'Action for ' + title,
    impact: 'Impact for ' + title,
    ...overrides,
  };
}
