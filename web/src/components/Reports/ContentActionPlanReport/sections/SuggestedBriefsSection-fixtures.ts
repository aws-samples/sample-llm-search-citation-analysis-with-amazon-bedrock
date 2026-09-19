import type { ContentIdea } from '../../../../types';

export function buildIdea(
  id: string,
  priority: 'high' | 'medium' | 'low',
  title: string,
): ContentIdea {
  return {
    id,
    type: 'visibility_gap',
    priority,
    title,
    description: 'd',
    keyword: 'kw',
    source: 'analysis',
    actionable: true,
    content_angle: 'comprehensive_guide',
  };
}
