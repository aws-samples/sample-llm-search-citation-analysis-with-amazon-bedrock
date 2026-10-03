import { expect } from 'vitest';
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

/** Matches the error a Content Studio decoder throws for an invalid `subject`. */
export function invalidContentStudioResponse(subject: string): unknown {
  return expect.objectContaining({
    name: 'InvalidContentStudioResponseError',
    message: `Content Studio API returned an invalid ${subject}`,
  });
}

/** Optional idea fields, each with a valid value. */
export const completeOptionalIdeaFields: Record<string, unknown> = {
  competitor_brands: ['Competitor'],
  competitor_urls: ['https://competitor.example'],
  providers_missing: ['openai'],
  providers_present: ['perplexity'],
  current_rank: 2.5,
  content_angle: 'differentiation',
  persona_name: 'Buyer',
  seasonal_theme: 'Summer',
  trending_topic: 'Launch',
  output_language: 'Spanish',
};

const OPTIONAL_IDEA_ARRAYS = ['competitor_brands', 'competitor_urls', 'providers_missing', 'providers_present'];

type DecoderRecordCase = [string, Record<string, unknown>];
type DecoderRecordBuilder = (overrides?: Record<string, unknown>) => Record<string, unknown>;

function missingRequiredFieldCases(
  fields: readonly string[],
  buildRecord: DecoderRecordBuilder
): DecoderRecordCase[] {
  return fields.map((field) => [
    `required field ${field} is missing`,
    omitDecoderField(buildRecord(), field),
  ]);
}

function nullOptionalStringCases(
  fields: readonly string[],
  buildRecord: DecoderRecordBuilder
): DecoderRecordCase[] {
  return fields.map((field) => [
    `optional string ${field} is null`,
    buildRecord({ [field]: null }),
  ]);
}

function buildSingleItemDecoderPayload(
  listKey: string,
  item: object,
  summary: Record<string, unknown>,
  overrides: Record<string, unknown>
): Record<string, unknown> {
  return {
    [listKey]: [item],
    total_count: 1,
    ...summary,
    ...overrides,
  };
}

/** Content idea records the decoder must reject, named by what is wrong with them. */
export const invalidContentIdeaCases: ReadonlyArray<[string, Record<string, unknown>]> = [
  ...missingRequiredFieldCases(
    ['id', 'type', 'priority', 'title', 'description', 'keyword', 'source', 'actionable'],
    buildContentIdeaDecoderRecord
  ),
  ...([
    ['id', 1],
    ['title', null],
    ['description', false],
    ['keyword', 1],
    ['source', []],
    ['actionable', 'true'],
    ['type', 'unknown_type'],
    ['type', 1],
    ['priority', 'urgent'],
    ['priority', null],
    ['content_angle', 'unknown_angle'],
    ['content_angle', 1],
  ] satisfies Array<[string, unknown]>).map(([field, value]): [string, Record<string, unknown>] => [
    `field ${field} is ${JSON.stringify(value)}`,
    buildContentIdeaDecoderRecord({ [field]: value }),
  ]),
  ...([
    ['is not an array', 'provider'],
    ['contains a non-string', ['valid', 1]],
  ] satisfies Array<[string, unknown]>).flatMap(([problem, value]) => OPTIONAL_IDEA_ARRAYS.map(
    (field): DecoderRecordCase => [
      `optional array ${field} ${problem}`,
      buildContentIdeaDecoderRecord({ [field]: value }),
    ]
  )),
  ...nullOptionalStringCases(
    ['persona_name', 'seasonal_theme', 'trending_topic', 'output_language'],
    buildContentIdeaDecoderRecord
  ),
  ...[null, 'first', Number.NaN].map((currentRank): [string, Record<string, unknown>] => [
    `optional current_rank is ${String(currentRank)}`,
    buildContentIdeaDecoderRecord({ current_rank: currentRank }),
  ]),
];

export function buildContentIdeaDecoderRecord(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    ...buildApiContentIdea(),
    ...overrides,
  };
}

export function buildIdeasDecoderPayload(
  idea: object = buildContentIdeaDecoderRecord(),
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildSingleItemDecoderPayload(
    'ideas',
    idea,
    { generated_at: '2026-01-01T00:00:00Z' },
    overrides
  );
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

/** History item records the decoder must reject, named by what is wrong with them. */
export const invalidHistoryItemCases: ReadonlyArray<[string, Record<string, unknown>]> = [
  ...missingRequiredFieldCases(
    ['id', 'keyword', 'status', 'created_at', 'updated_at'],
    buildHistoryItemDecoderRecord
  ),
  ...([
    ['id', 1],
    ['keyword', null],
    ['status', 'unknown'],
    ['created_at', 1],
    ['updated_at', false],
  ] satisfies Array<[string, unknown]>).map(([field, value]): [string, Record<string, unknown>] => [
    `required field ${field} is ${JSON.stringify(value)}`,
    buildHistoryItemDecoderRecord({ [field]: value }),
  ]),
  ...nullOptionalStringCases(
    ['idea_title', 'content_angle', 'error_message', 'batch_id', 'keyword_id'],
    buildHistoryItemDecoderRecord
  ),
  ...[null, 'true', 1].map((viewed): [string, Record<string, unknown>] => [
    `optional viewed is ${JSON.stringify(viewed)}`,
    buildHistoryItemDecoderRecord({ viewed }),
  ]),
];

export function buildHistoryDecoderPayload(
  historyItem: object = buildHistoryItemDecoderRecord(),
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return buildSingleItemDecoderPayload('history', historyItem, { unviewed_count: 0 }, overrides);
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

/** What the history decoder returns for a legacy row that carries only the required fields. */
export function buildDecodedLegacyHistoryItem(updatedAt: string): Record<string, unknown> {
  return {
    id: 'legacy',
    keyword: 'Legacy keyword',
    idea_title: 'Legacy keyword',
    content_angle: '',
    competitor_sources_used: 0,
    status: 'generated',
    viewed: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: updatedAt,
    generated_content: undefined,
    content_warning: undefined,
    error_message: undefined,
    batch_id: undefined,
    batch_size: undefined,
    batch_position: undefined,
    keyword_id: undefined,
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
  templates: readonly object[] = [buildTemplateDecoderRecord()],
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    items: templates,
    count: templates.length,
    ...overrides,
  };
}
