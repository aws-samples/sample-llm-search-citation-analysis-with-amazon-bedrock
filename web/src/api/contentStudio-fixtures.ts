import type {
  ContentBriefBatchRequest,
  ContentBriefBatchStartResponse,
  ContentBriefBatchStatusResponse,
  ContentBriefTemplate,
  ContentIdea,
  ContentStudioHistory,
  GroupBriefIdea,
} from '../types';
import { GROUP_BRIEF_DEFAULT_TEMPLATES } from '../components/ContentStudio/GroupBriefForm-source';

export function buildApiContentIdea(
  overrides: Partial<ContentIdea> = {}
): ContentIdea {
  return {
    id: 'idea-1',
    type: 'visibility_gap',
    priority: 'high',
    title: 'Visibility guide',
    description: 'Create a guide for a visibility gap.',
    keyword: 'alpha keyword',
    source: 'visibility_analysis',
    competitor_urls: [],
    actionable: true,
    content_angle: 'comprehensive_guide',
    ...overrides,
  };
}

export function buildApiHistoryItem(
  overrides: Partial<ContentStudioHistory> = {}
): ContentStudioHistory {
  return {
    id: 'content-1',
    keyword: 'alpha keyword',
    idea_title: 'Visibility guide',
    content_angle: 'comprehensive_guide',
    competitor_sources_used: 0,
    status: 'pending',
    viewed: false,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

export function buildApiTemplate(
  overrides: Partial<ContentBriefTemplate> = {}
): ContentBriefTemplate {
  return {
    id: 'builtin-create-new-landing-page',
    name: 'Create new landing page',
    description: 'Create a complete landing page from the selected keyword scope.',
    content_angle: 'create_new_landing_page',
    prompt_template: GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page,
    builtin: true,
    created_by: null,
    created_at: null,
    updated_at: null,
    ...overrides,
  };
}

export function buildApiGroupBriefIdea(
  overrides: Partial<GroupBriefIdea> = {}
): GroupBriefIdea {
  return {
    id: 'brief-1',
    type: 'group_brief',
    scope: {
      mode: 'keywords',
      keyword_ids: ['keyword-1'],
    },
    content_angle: 'create_new_landing_page',
    landing_url: '',
    current_copy: '',
    template_id: 'builtin-create-new-landing-page',
    prompt_template: GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page,
    output_language: 'English',
    ...overrides,
  };
}

export const apiGroupBriefIdea = buildApiGroupBriefIdea();

export function buildApiBatchRequest(
  overrides: Partial<ContentBriefBatchRequest> = {}
): ContentBriefBatchRequest {
  return {
    batch_id: 'batch/id',
    scope: {
      mode: 'keywords',
      keyword_ids: ['keyword-1', 'keyword-2'],
    },
    brief: {
      content_angle: 'create_new_landing_page',
      landing_url: '',
      current_copy: '',
      template_id: 'builtin-create-new-landing-page',
      prompt_template: GROUP_BRIEF_DEFAULT_TEMPLATES.create_new_landing_page,
      output_language: 'English',
    },
    ...overrides,
  };
}

export const apiBatchRequest = buildApiBatchRequest();

export const apiBatchStartResponse: ContentBriefBatchStartResponse = {
  success: true,
  batch_id: 'batch/id',
  batch_size: 2,
  accepted_count: 2,
  existing_count: 0,
  failed_count: 0,
  children: [
    {
      id: 'content-1',
      idea_id: 'idea-1',
      keyword_id: 'keyword-1',
      keyword: 'Alpha keyword',
      status: 'pending',
      batch_position: 1,
      idempotent_hit: false,
    },
    {
      id: 'content-2',
      idea_id: 'idea-2',
      keyword_id: 'keyword-2',
      keyword: 'Beta keyword',
      status: 'pending',
      batch_position: 2,
      idempotent_hit: false,
    },
  ],
};

export const apiBatchStatusResponse: ContentBriefBatchStatusResponse = {
  batch_id: 'batch/id',
  batch_size: 2,
  children: [
    {
      id: 'content-1',
      idea_id: 'idea-1',
      keyword_id: 'keyword-1',
      keyword: 'Alpha keyword',
      status: 'generated',
      batch_position: 1,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:01:00Z',
      has_content: true,
      error_message: null,
    },
    {
      id: 'content-2',
      idea_id: 'idea-2',
      keyword_id: 'keyword-2',
      keyword: 'Beta keyword',
      status: 'failed',
      batch_position: 2,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:01:00Z',
      has_content: false,
      error_message: 'Generation failed',
    },
  ],
  counts: {
    pending: 0,
    generating: 0,
    generated: 1,
    failed: 1,
    missing: 0,
    total: 2,
  },
};

export function buildApiMissingBatchStatusResponse(
  batchId = 'batch/id'
): ContentBriefBatchStatusResponse {
  return {
    ...apiBatchStatusResponse,
    batch_id: batchId,
    children: [
      apiBatchStatusResponse.children[0],
      {
        ...apiBatchStatusResponse.children[1],
        status: 'missing',
        created_at: null,
        updated_at: null,
        has_content: false,
        error_message: 'Content is no longer available',
      },
    ],
    counts: {
      pending: 0,
      generating: 0,
      generated: 1,
      failed: 0,
      missing: 1,
      total: 2,
    },
  };
}
