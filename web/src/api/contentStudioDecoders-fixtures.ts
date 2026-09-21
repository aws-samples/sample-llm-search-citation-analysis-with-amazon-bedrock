import type {
  ContentAngle,
  ContentIdeaType,
  ContentPriority,
  ContentStatus,
  GroupBriefMode,
} from '../types';
import {
  buildApiContentIdea, buildApiHistoryItem, buildApiTemplate
} from './contentStudio-fixtures';

export const validContentIdeaTypes = [
  'visibility_gap',
  'ranking_improvement',
  'provider_gap',
  'configuration',
  'data',
  'self_reflection',
  'seasonal_content',
  'trending_topic',
  'evergreen_content',
  'citation_opportunity',
  'leadership_maintenance',
  'sentiment_improvement',
  'group_brief',
] satisfies readonly ContentIdeaType[];

export const validContentPriorities = [
  'high', 'medium', 'low',
] satisfies readonly ContentPriority[];

export const validContentStatuses = [
  'pending', 'generating', 'generated', 'failed',
] satisfies readonly ContentStatus[];

export const validContentAngles = [
  'comprehensive_guide',
  'differentiation',
  'provider_optimization',
  'thought_leadership',
  'reputation_management',
  'seasonal',
  'trending',
  'evergreen',
  'improve_current_url',
  'rewrite_pasted_copy',
  'create_new_landing_page',
] satisfies readonly ContentAngle[];

export const validGroupBriefModes = [
  'improve_current_url',
  'rewrite_pasted_copy',
  'create_new_landing_page',
] satisfies readonly GroupBriefMode[];

export const invalidIntegerRepresentations: readonly unknown[] = [
  undefined,
  null,
  true,
  -1,
  1.5,
  Number.NaN,
  Number.POSITIVE_INFINITY,
  Number.NEGATIVE_INFINITY,
  Number.MAX_SAFE_INTEGER + 1,
  [],
  [1],
  {},
  '',
  ' 1',
  '1 ',
  '+1',
  '-1',
  '1.0',
  '1e2',
  'one',
];

export function omitDecoderField(
  record: Record<string, unknown>,
  field: string
): Record<string, unknown> {
  const omitted = { ...record };
  Reflect.deleteProperty(omitted, field);
  return omitted;
}

export function buildContentIdeaDecoderRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...buildApiContentIdea(),
    ...overrides,
  };
}

export function buildIdeasDecoderPayload(
  idea: Record<string, unknown> = buildContentIdeaDecoderRecord(),
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ideas: [idea],
    total_count: 1,
    generated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function buildGeneratedContentDecoderRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    title: 'Generated title',
    meta_description: 'Generated description',
    body: '# Generated body',
    suggested_headings: ['First heading'],
    key_points: ['First point'],
    ...overrides,
  };
}

export const invalidGeneratedContentDecoderCases = [
  ...[
    'title',
    'meta_description',
    'body',
    'suggested_headings',
    'key_points',
  ].map((field) => ({
    testName: `rejects generated content when required field ${field} is missing`,
    generatedContent: omitDecoderField(buildGeneratedContentDecoderRecord(), field),
  })),
  ...[
    {
      field: 'title',
      invalidValue: 1,
    },
    {
      field: 'meta_description',
      invalidValue: null,
    },
    {
      field: 'body',
      invalidValue: false,
    },
    {
      field: 'suggested_headings',
      invalidValue: 'heading',
    },
    {
      field: 'key_points',
      invalidValue: {},
    },
  ].map(({
    field, invalidValue
  }) => ({
    testName: `rejects generated content when required field ${field} has the wrong type`,
    generatedContent: buildGeneratedContentDecoderRecord({ [field]: invalidValue }),
  })),
  ...['suggested_headings', 'key_points'].map((field) => ({
    testName: `rejects generated content when string array ${field} contains a non-string`,
    generatedContent: buildGeneratedContentDecoderRecord({ [field]: ['valid', 1] }),
  })),
  {
    testName: 'rejects generated content when its value is null',
    generatedContent: null,
  },
  {
    testName: 'rejects generated content when its value is an array',
    generatedContent: [],
  },
  {
    testName: 'rejects generated content when its value is a string',
    generatedContent: 'content',
  },
];

export function buildHistoryItemDecoderRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...buildApiHistoryItem(),
    generated_content: {},
    ...overrides,
  };
}

export function buildHistoryItemWithGeneratedContent(
  generatedContent: unknown
): Record<string, unknown> {
  return buildHistoryItemDecoderRecord({ generated_content: generatedContent });
}

export function buildHistoryDecoderPayload(
  historyItem: Record<string, unknown> = buildHistoryItemDecoderRecord(),
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    history: [historyItem],
    total_count: 1,
    unviewed_count: 0,
    ...overrides,
  };
}

export function buildGenerationDecoderPayload(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    success: true,
    id: 'content-1',
    status: 'pending',
    keyword: 'Alpha keyword',
    ...overrides,
  };
}

export function buildTemplateDecoderRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...buildApiTemplate(),
    ...overrides,
  };
}

export function buildTemplateListDecoderPayload(
  templates: readonly Record<string, unknown>[] = [buildTemplateDecoderRecord()],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    items: templates,
    count: templates.length,
    ...overrides,
  };
}
