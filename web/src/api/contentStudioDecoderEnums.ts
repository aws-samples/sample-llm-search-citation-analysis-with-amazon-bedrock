import type {
  ContentAngle,
  ContentBriefBatchStatus,
  ContentIdeaType,
  ContentPriority,
  ContentStatus,
  GroupBriefMode,
} from '../types';

export function contentIdeaTypes(): readonly ContentIdeaType[] {
  return [
    'visibility_gap', 'ranking_improvement', 'provider_gap', 'configuration',
    'data', 'self_reflection', 'seasonal_content', 'trending_topic',
    'evergreen_content', 'citation_opportunity', 'leadership_maintenance',
    'sentiment_improvement', 'group_brief',
  ];
}

export function contentPriorities(): readonly ContentPriority[] {
  return ['high', 'medium', 'low'];
}

export function contentStatuses(): readonly ContentStatus[] {
  return ['pending', 'generating', 'generated', 'failed'];
}

export function contentBriefBatchStatuses(): readonly ContentBriefBatchStatus[] {
  return [...contentStatuses(), 'missing'];
}

export function contentAngles(): readonly ContentAngle[] {
  return [
    'comprehensive_guide', 'differentiation', 'provider_optimization',
    'thought_leadership', 'reputation_management', 'seasonal', 'trending',
    'evergreen', 'improve_current_url', 'rewrite_pasted_copy',
    'create_new_landing_page',
  ];
}

export function groupBriefModes(): readonly GroupBriefMode[] {
  return [
    'improve_current_url', 'rewrite_pasted_copy', 'create_new_landing_page',
  ];
}
