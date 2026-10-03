import {
  StrictMode, createElement, type ReactNode
} from 'react';
import {
  act, renderHook
} from '@testing-library/react';
import { vi } from 'vitest';
import { buildApiTemplate } from '../api/contentStudio-fixtures';
import {
  createMockJsonResponse, type DeferredResponse
} from '../test/fetchResponses';
import {
  deferAuthenticatedFetch, mockAuthenticatedFetch
} from '../test/infrastructureMock';
import { renderLoadedHook } from '../test/loadedHook';
import type {
  ContentBriefTemplate, ContentBriefTemplateDraft
} from '../types';
import { useContentBriefTemplates } from './useContentBriefTemplates';

export const builtinCreateTemplate = buildApiTemplate();
export const builtinRewriteTemplate = buildApiTemplate({
  id: 'builtin-rewrite-pasted-copy',
  name: 'Rewrite pasted copy',
  content_angle: 'rewrite_pasted_copy',
});
export const savedUrbanTemplate = buildApiTemplate({
  id: 'saved-urban',
  name: 'Urban campaign',
  builtin: false,
  created_by: 'user-1',
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
});
export const savedBeachTemplate = buildApiTemplate({
  id: 'saved-beach',
  name: 'Beach campaign',
  builtin: false,
});

export const expectedOrderedTemplateIds = [
  'builtin-create-new-landing-page',
  'builtin-rewrite-pasted-copy',
  'saved-beach',
  'saved-urban',
];

function templateListResponse(templates: ContentBriefTemplate[]) {
  return {
    items: templates,
    count: templates.length,
  };
}

/** The GET /content-studio/templates response listing `templates`. */
export function templateListJsonResponse(templates: ContentBriefTemplate[]): Response {
  return createMockJsonResponse(templateListResponse(templates));
}

/** Answers every request with the list of `templates`. */
export function serveTemplateList(templates: ContentBriefTemplate[]): void {
  mockAuthenticatedFetch.mockResolvedValue(templateListJsonResponse(templates));
}

/** A create-template draft for the landing-page angle; every field can be overridden. */
export function buildTemplateDraft(
  overrides: Partial<ContentBriefTemplateDraft> = {}
): ContentBriefTemplateDraft {
  return {
    name: 'Campaign',
    description: '',
    contentAngle: 'create_new_landing_page',
    promptTemplate: 'Create for {scope}.',
    ...overrides,
  };
}

interface TemplateHookStrictModeProps { readonly children: ReactNode; }

function templateHookStrictMode({ children }: TemplateHookStrictModeProps) {
  return createElement(StrictMode, null, children);
}

export function renderLoadedContentBriefTemplates() {
  return renderLoadedHook(() => useContentBriefTemplates());
}

export function renderLoadedContentBriefTemplatesInStrictMode() {
  return renderLoadedHook(() => useContentBriefTemplates(), { wrapper: templateHookStrictMode });
}

/** Renders the hook while its initial list request stays in flight until `deferred` settles. */
export function renderPendingContentBriefTemplates() {
  const deferred = deferAuthenticatedFetch();
  return {
    deferred,
    ...renderHook(() => useContentBriefTemplates()),
  };
}

/** Answers `deferred` with the list of `templates` and flushes the resulting updates. */
export async function settleTemplateList(
  deferred: DeferredResponse,
  templates: ContentBriefTemplate[]
): Promise<void> {
  deferred.resolve(templateListJsonResponse(templates));
  await act(async () => {
    await deferred.promise;
  });
}

/** The ids of `templates`, in list order. */
export function templateIds(templates: readonly ContentBriefTemplate[]): string[] {
  return templates.map((template) => template.id);
}

export function respondTemplateNotFound(): void {
  mockAuthenticatedFetch.mockResolvedValueOnce(
    createMockJsonResponse({ error: 'Template not found' }, 404)
  );
}

export function prepareTemplateHookResponses(): void {
  vi.clearAllMocks();
  mockAuthenticatedFetch.mockResolvedValue(createMockJsonResponse(
    templateListResponse([builtinCreateTemplate, savedUrbanTemplate])
  ));
}
