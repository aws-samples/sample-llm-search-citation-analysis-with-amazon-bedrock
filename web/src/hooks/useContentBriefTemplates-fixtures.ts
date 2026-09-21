import {
  StrictMode, createElement, type ReactNode
} from 'react';
import {
  renderHook, waitFor
} from '@testing-library/react';
import {
  expect, vi
} from 'vitest';
import { buildApiTemplate } from '../api/contentStudio-fixtures';
import { createMockJsonResponse } from '../test/fetchResponses';
import { mockAuthenticatedFetch } from '../test/infrastructureMock';
import type { ContentBriefTemplate } from '../types';
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

export function templateListResponse(templates: ContentBriefTemplate[]) {
  return {
    items: templates,
    count: templates.length,
  };
}

interface TemplateHookStrictModeProps { readonly children: ReactNode; }

export function templateHookStrictMode({ children }: TemplateHookStrictModeProps) {
  return createElement(StrictMode, null, children);
}

export async function renderLoadedContentBriefTemplates() {
  const rendered = renderHook(() => useContentBriefTemplates());
  await waitFor(() => {
    expect(rendered.result.current.loading).toBe(false);
  });
  return rendered;
}

export async function renderLoadedContentBriefTemplatesInStrictMode() {
  const rendered = renderHook(
    () => useContentBriefTemplates(),
    {wrapper: templateHookStrictMode,}
  );
  await waitFor(() => {
    expect(rendered.result.current.loading).toBe(false);
  });
  return rendered;
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
