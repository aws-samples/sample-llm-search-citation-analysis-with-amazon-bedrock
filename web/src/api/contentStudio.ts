import {
  apiDelete, apiGet, apiPost, apiPut
} from './client';
import {
  decodeBatchStartResponse,
  decodeBatchStatusResponse,
  decodeContentBriefTemplate,
  decodeContentHistoryResponse,
  decodeContentIdeasResponse,
  decodeContentStatus,
  decodeDeletedContent,
  decodeDeletedTemplate,
  decodeGenerateContentResponse,
  decodeTemplateList,
  decodeViewedResponse,
} from './contentStudioDecoders';
import type {
  ContentBriefBatchRequest,
  ContentBriefBatchStartResponse,
  ContentBriefBatchStatusResponse,
  ContentBriefTemplate,
  ContentBriefTemplateChanges,
  ContentBriefTemplateDraft,
  ContentGenerationIdea,
  ContentIdea,
  ContentStatus,
  GenerateContentResponse,
} from '../types';
import type { DecodedContentHistory } from './contentStudioDecoders';

function templateBody(draft: ContentBriefTemplateDraft): Record<string, unknown> {
  return {
    name: draft.name,
    description: draft.description,
    content_angle: draft.contentAngle,
    prompt_template: draft.promptTemplate,
  };
}

function templateChangesBody(
  changes: ContentBriefTemplateChanges
): Record<string, unknown> {
  return {
    name: changes.name,
    description: changes.description,
    content_angle: changes.contentAngle,
    prompt_template: changes.promptTemplate,
  };
}

export async function fetchContentIdeas(signal?: AbortSignal): Promise<ContentIdea[]> {
  return decodeContentIdeasResponse(
    await apiGet<unknown>('/content-studio/ideas', { signal })
  );
}

export async function fetchContentHistory(
  limit = 20,
  signal?: AbortSignal
): Promise<DecodedContentHistory> {
  return decodeContentHistoryResponse(await apiGet<unknown>('/content-studio/history', {
    params: { limit: String(limit) },
    signal,
  }));
}

export async function startContentGeneration(
  idea: ContentGenerationIdea
): Promise<GenerateContentResponse> {
  return decodeGenerateContentResponse(await apiPost<unknown>(
    '/content-studio/generate',
    { idea },
    { allowStructured4xx: true }
  ));
}

export async function fetchContentStatus(
  id: string,
  signal?: AbortSignal
): Promise<ContentStatus> {
  return decodeContentStatus(await apiGet<unknown>(
    `/content-studio/status/${encodeURIComponent(id)}`,
    { signal }
  ), id);
}

export async function startContentBriefBatch(
  request: ContentBriefBatchRequest
): Promise<ContentBriefBatchStartResponse> {
  return decodeBatchStartResponse(await apiPost<unknown>(
    '/content-studio/generate-batch',
    request,
    { allowStructured4xx: true }
  ), request.batch_id);
}

export async function fetchContentBriefBatch(
  batchId: string,
  signal?: AbortSignal
): Promise<ContentBriefBatchStatusResponse> {
  return decodeBatchStatusResponse(await apiGet<unknown>(
    `/content-studio/batches/${encodeURIComponent(batchId)}`,
    { signal }
  ), batchId);
}

export async function markContentViewed(id: string): Promise<void> {
  decodeViewedResponse(
    await apiPost<unknown>('/content-studio/viewed', { id }),
    id
  );
}

export async function deleteGeneratedContent(id: string): Promise<void> {
  decodeDeletedContent(await apiDelete<unknown>(
    `/content-studio/${encodeURIComponent(id)}`,
    { allowStructured4xx: true }
  ));
}

export async function fetchContentBriefTemplates(
  signal?: AbortSignal
): Promise<ContentBriefTemplate[]> {
  return decodeTemplateList(
    await apiGet<unknown>('/content-studio/templates', { signal })
  );
}

export async function createContentBriefTemplate(
  draft: ContentBriefTemplateDraft
): Promise<ContentBriefTemplate> {
  return decodeContentBriefTemplate(await apiPost<unknown>(
    '/content-studio/templates',
    templateBody(draft),
    { allowStructured4xx: true }
  ));
}

export async function updateContentBriefTemplate(
  id: string,
  changes: ContentBriefTemplateChanges
): Promise<ContentBriefTemplate> {
  return decodeContentBriefTemplate(await apiPut<unknown>(
    `/content-studio/templates/${encodeURIComponent(id)}`,
    templateChangesBody(changes),
    { allowStructured4xx: true }
  ));
}

export async function deleteContentBriefTemplate(id: string): Promise<void> {
  decodeDeletedTemplate(await apiDelete<unknown>(
    `/content-studio/templates/${encodeURIComponent(id)}`,
    { allowStructured4xx: true }
  ));
}
