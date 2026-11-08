import {
  apiDelete, apiGet, apiPost, apiPut
} from './client';
import { withNextToken } from './cursorPages';
import {
  decodeBatchStartResponse,
  decodeBatchStatusResponse,
  decodeContentBriefTemplate,
  decodeContentHistoryResponse,
  decodeContentIdeasPageInfo,
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
import type {
  ContentIdeasPageInfo, DecodedContentHistory
} from './contentStudioDecoders';
import { ApiRequestError } from '../infrastructure';
import { isRecord } from '../types/domain/keywordDecoders';
import type {
  ComputingResponse, ScopedResponseFields
} from '../types/domain/scopeCoverage';
import { hasScopedResponseFields } from '../types/domain/scopeCoverageDecoders';

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

/** Which ideas page to read (2.45.0 wave 5): the scope and market, the cursor, and who learns where the page sits. */
export interface ContentIdeasQuery {
  /** `scope=all` / `group_id` / `keyword`, and `market_id` (the header market). */
  readonly params?: Readonly<Record<string, string>>;
  readonly nextToken?: string | null;
  readonly onPage?: (page: ContentIdeasPageInfo) => void;
}

/**
 * One page of the content ideas of a scope (every keyword by default). `onScope` receives the
 * answer's 2.45.0 coverage and source fields (none from older API builds), `onComputing` each
 * `202` while a view job derives them, and `query.onPage` the cursor of the next page and the total.
 */
export async function fetchContentIdeas(
  signal?: AbortSignal,
  onScope?: (scope: ScopedResponseFields) => void,
  onComputing?: (computing: ComputingResponse) => void,
  query: ContentIdeasQuery = {},
): Promise<ContentIdea[]> {
  const payload = await apiGet<unknown>('/content-studio/ideas', {
    ...(query.params === undefined && (query.nextToken ?? null) === null
      ? {}
      : { params: withNextToken({ ...query.params }, query.nextToken ?? null) }),
    signal,
    onComputing,
  });
  const ideas = decodeContentIdeasResponse(payload);
  query.onPage?.(decodeContentIdeasPageInfo(payload));
  if (!isRecord(payload) || !hasScopedResponseFields(payload)) throw new ApiRequestError('Invalid ideas coverage');
  onScope?.({
    coverage: payload.coverage,
    source: payload.source,
    as_of: payload.as_of,
    stale: payload.stale,
    refreshing: payload.refreshing,
  });
  return ideas;
}

export async function fetchContentHistory(
  limit = 20,
  signal?: AbortSignal,
  nextToken: string | null = null
): Promise<DecodedContentHistory> {
  return decodeContentHistoryResponse(await apiGet<unknown>('/content-studio/history', {
    params: withNextToken({ limit: String(limit) }, nextToken),
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
    // The status poll counts consecutive failures and retries on its next tick.
    {
      signal,
      retry: false,
    }
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

export async function fetchContentBriefBatch(batchId: string): Promise<ContentBriefBatchStatusResponse> {
  return decodeBatchStatusResponse(await apiGet<unknown>(
    `/content-studio/batches/${encodeURIComponent(batchId)}`
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

export async function fetchContentBriefTemplates(): Promise<ContentBriefTemplate[]> {
  return decodeTemplateList(
    await apiGet<unknown>('/content-studio/templates')
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
