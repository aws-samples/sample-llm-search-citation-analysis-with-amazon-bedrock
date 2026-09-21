import type {
  ContentBriefTemplate,
  ContentIdea,
  ContentStatus,
  ContentStudioHistory,
  ContentWarning,
  GenerateContentResponse,
  GeneratedContent,
} from '../types';
import {
  decodeInteger,
  invalid,
  isAllowedString,
  isFiniteNumber,
  isNullableString,
  isOptionalString,
  isOptionalStringArray,
  isRecord,
  isStringArray,
  optionalInteger,
  optionalResponseBoolean,
  optionalResponseString,
} from './contentStudioDecoderPrimitives';
import {
  contentAngles,
  contentIdeaTypes,
  contentPriorities,
  contentStatuses,
  groupBriefModes,
} from './contentStudioDecoderEnums';

export {
  decodeBatchStartResponse,
  decodeBatchStatusResponse,
} from './contentStudioBatchDecoders';

function hasIdeaCore(value: Record<string, unknown>): boolean {
  return typeof value.id === 'string'
    && isAllowedString(value.type, contentIdeaTypes())
    && isAllowedString(value.priority, contentPriorities())
    && typeof value.title === 'string'
    && typeof value.description === 'string'
    && isNullableString(value.keyword)
    && typeof value.source === 'string'
    && typeof value.actionable === 'boolean';
}

function hasIdeaLists(value: Record<string, unknown>): boolean {
  return isOptionalStringArray(value.competitor_brands)
    && isOptionalStringArray(value.competitor_urls)
    && isOptionalStringArray(value.providers_missing)
    && isOptionalStringArray(value.providers_present);
}

function hasIdeaDetails(value: Record<string, unknown>): boolean {
  return (value.current_rank === undefined || isFiniteNumber(value.current_rank))
    && (value.content_angle === undefined || isAllowedString(value.content_angle, contentAngles()))
    && isOptionalString(value.persona_name)
    && isOptionalString(value.seasonal_theme)
    && isOptionalString(value.trending_topic)
    && isOptionalString(value.output_language);
}

function isContentIdea(value: unknown): value is ContentIdea {
  return isRecord(value)
    && hasIdeaCore(value)
    && hasIdeaLists(value)
    && hasIdeaDetails(value);
}

function decodeContentIdea(value: unknown): ContentIdea {
  if (!isContentIdea(value)) throw invalid('content idea');
  return value;
}

function isGeneratedContent(value: unknown): value is GeneratedContent {
  return isRecord(value)
    && typeof value.title === 'string'
    && typeof value.meta_description === 'string'
    && typeof value.body === 'string'
    && isStringArray(value.suggested_headings)
    && isStringArray(value.key_points);
}

function decodeGeneratedContent(value: unknown): GeneratedContent | undefined {
  if (value === undefined) return undefined;
  if (isRecord(value) && Object.keys(value).length === 0) return undefined;
  if (!isGeneratedContent(value)) throw invalid('generated content');
  return value;
}

function isContentWarning(value: unknown): value is ContentWarning {
  return isRecord(value)
    && value.code === 'incomplete_metadata'
    && typeof value.message === 'string'
    && isStringArray(value.missing_fields);
}

// Display-only: a warning that fails validation is dropped, never fatal to the history list.
function decodeContentWarning(value: unknown): ContentWarning | undefined {
  return isContentWarning(value) ? value : undefined;
}

type HistoryCoreRecord = Record<string, unknown> & {
  id: string;
  keyword: string;
  idea_title?: string;
  content_angle?: string;
  status: ContentStatus;
  viewed?: boolean;
  created_at: string;
  updated_at: string;
};

type HistoryOptionalRecord = Record<string, unknown> & {
  error_message?: string;
  batch_id?: string;
  keyword_id?: string;
};

function hasHistoryCore(value: Record<string, unknown>): value is HistoryCoreRecord {
  return typeof value.id === 'string'
    && typeof value.keyword === 'string'
    && isOptionalString(value.idea_title)
    && isOptionalString(value.content_angle)
    && isAllowedString(value.status, contentStatuses())
    && (value.viewed === undefined || typeof value.viewed === 'boolean')
    && typeof value.created_at === 'string'
    && typeof value.updated_at === 'string';
}

function hasHistoryOptionals(
  value: Record<string, unknown>
): value is HistoryOptionalRecord {
  return isOptionalString(value.error_message)
    && isOptionalString(value.batch_id)
    && isOptionalString(value.keyword_id);
}

function decodeContentHistoryItem(value: unknown): ContentStudioHistory {
  if (!isRecord(value) || !hasHistoryCore(value) || !hasHistoryOptionals(value)) {
    throw invalid('history item');
  }
  const generatedContent = decodeGeneratedContent(value.generated_content);
  const batchSize = optionalInteger(value.batch_size, 'history batch size');
  const batchPosition = optionalInteger(value.batch_position, 'history batch position');
  const competitorSources = value.competitor_sources_used === undefined
    ? 0
    : decodeInteger(value.competitor_sources_used, 'competitor source count');
  return {
    id: value.id,
    keyword: value.keyword,
    idea_title: value.idea_title ?? value.keyword,
    content_angle: value.content_angle ?? '',
    competitor_sources_used: competitorSources,
    status: value.status,
    viewed: value.viewed ?? false,
    created_at: value.created_at,
    updated_at: value.updated_at,
    generated_content: generatedContent,
    content_warning: decodeContentWarning(value.content_warning),
    error_message: optionalResponseString(value.error_message),
    batch_id: optionalResponseString(value.batch_id),
    batch_size: batchSize,
    batch_position: batchPosition,
    keyword_id: optionalResponseString(value.keyword_id),
  };
}

export function decodeContentIdeasResponse(payload: unknown): ContentIdea[] {
  if (!isRecord(payload) || !Array.isArray(payload.ideas)) throw invalid('ideas response');
  const expectedCount = decodeInteger(payload.total_count, 'idea count');
  if (typeof payload.generated_at !== 'string') throw invalid('generation timestamp');
  const ideas = payload.ideas.map(decodeContentIdea);
  if (ideas.length !== expectedCount) throw invalid('idea count');
  return ideas;
}

export interface DecodedContentHistory {
  history: ContentStudioHistory[];
  unviewedCount: number;
}

export function decodeContentHistoryResponse(payload: unknown): DecodedContentHistory {
  if (!isRecord(payload) || !Array.isArray(payload.history)) throw invalid('history response');
  decodeInteger(payload.total_count, 'history count');
  return {
    history: payload.history.map(decodeContentHistoryItem),
    unviewedCount: decodeInteger(payload.unviewed_count, 'unviewed count'),
  };
}

type GenerateCoreRecord = Record<string, unknown> & {
  success: boolean;
  id: string;
  status: ContentStatus;
  keyword: string;
};

type GenerateOptionalRecord = Record<string, unknown> & {
  message?: string;
  error?: string;
  idempotent_hit?: boolean;
};

function hasGenerateCore(value: Record<string, unknown>): value is GenerateCoreRecord {
  return typeof value.success === 'boolean'
    && typeof value.id === 'string'
    && isAllowedString(value.status, contentStatuses())
    && typeof value.keyword === 'string';
}

function hasGenerateOptionals(
  value: Record<string, unknown>
): value is GenerateOptionalRecord {
  return isOptionalString(value.message)
    && isOptionalString(value.error)
    && (value.idempotent_hit === undefined
      || typeof value.idempotent_hit === 'boolean');
}

export function decodeGenerateContentResponse(payload: unknown): GenerateContentResponse {
  if (!isRecord(payload) || !hasGenerateCore(payload) || !hasGenerateOptionals(payload)) {
    throw invalid('generation response');
  }
  return {
    success: payload.success,
    id: payload.id,
    status: payload.status,
    keyword: payload.keyword,
    message: optionalResponseString(payload.message),
    error: optionalResponseString(payload.error),
    idempotent_hit: optionalResponseBoolean(payload.idempotent_hit),
  };
}

function isContentBriefTemplate(value: unknown): value is ContentBriefTemplate {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.name === 'string'
    && typeof value.description === 'string'
    && isAllowedString(value.content_angle, groupBriefModes())
    && typeof value.prompt_template === 'string'
    && typeof value.builtin === 'boolean'
    && isNullableString(value.created_by)
    && isNullableString(value.created_at)
    && isNullableString(value.updated_at);
}

export function decodeContentBriefTemplate(payload: unknown): ContentBriefTemplate {
  if (!isContentBriefTemplate(payload)) throw invalid('Content Brief template');
  return payload;
}

export function decodeTemplateList(payload: unknown): ContentBriefTemplate[] {
  if (!isRecord(payload) || !Array.isArray(payload.items)) throw invalid('template list');
  const templates = payload.items.map(decodeContentBriefTemplate);
  if (templates.length !== decodeInteger(payload.count, 'template count')) {
    throw invalid('template count');
  }
  return templates;
}

export function decodeContentStatus(payload: unknown, id: string): ContentStatus {
  if (!isRecord(payload) || payload.id !== id || !isAllowedString(payload.status, contentStatuses())) {
    throw invalid('content status');
  }
  return payload.status;
}

export function decodeViewedResponse(payload: unknown, id: string): void {
  if (!isRecord(payload) || payload.success !== true || payload.id !== id) {
    throw invalid('viewed response');
  }
}

export function decodeDeletedContent(payload: unknown): void {
  if (!isRecord(payload) || payload.success !== true || typeof payload.message !== 'string') {
    throw invalid('delete response');
  }
}

export function decodeDeletedTemplate(payload: unknown): void {
  if (!isRecord(payload) || payload.message !== 'Template deleted successfully') {
    throw invalid('template delete response');
  }
}
