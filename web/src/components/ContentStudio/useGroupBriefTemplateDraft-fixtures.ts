import {
  StrictMode, createElement, type ReactNode
} from 'react';
import {
  act, renderHook
} from '@testing-library/react';
import { vi } from 'vitest';
import {
  useContentBriefTemplates,
  type ContentBriefTemplateMutationOutcome,
} from '../../hooks/useContentBriefTemplates';
import type { GroupBriefMode } from '../../types';
import {
  buildContentBriefTemplate,
  buildContentBriefTemplatesHookResult,
} from './GroupBriefForm-fixtures';
import { useGroupBriefTemplateDraft } from './useGroupBriefTemplateDraft';

export const mockUseContentBriefTemplates = vi.mocked(useContentBriefTemplates);

export const savedGroupBriefTemplate = buildContentBriefTemplate({
  id: 'saved-template',
  name: 'Saved campaign',
  description: 'Saved description',
  prompt_template: 'Saved prompt for {scope}.',
  builtin: false,
});

export const createdGroupBriefTemplate = buildContentBriefTemplate({
  id: 'created-template',
  name: 'Created template',
  description: 'Created description',
  prompt_template: 'Created prompt for {scope}.',
  builtin: false,
});

interface DeferredTemplateSettlers { resolve: (outcome: ContentBriefTemplateMutationOutcome) => void; }

export function createDeferredTemplateMutation() {
  const settlers: DeferredTemplateSettlers = { resolve: vi.fn() };
  const promise = new Promise<ContentBriefTemplateMutationOutcome>((resolve) => {
    settlers.resolve = resolve;
  });
  return {
    promise,
    resolve: (outcome: ContentBriefTemplateMutationOutcome) => {
      act(() => settlers.resolve(outcome));
    },
  };
}

export function buildGroupBriefTemplateDraftHookResult(
  overrides: Partial<ReturnType<typeof useContentBriefTemplates>> = {}
): ReturnType<typeof useContentBriefTemplates> {
  const base = buildContentBriefTemplatesHookResult();
  return buildContentBriefTemplatesHookResult({
    templates: [...base.templates, savedGroupBriefTemplate],
    ...overrides,
  });
}

export function prepareGroupBriefTemplateDraftMocks(): void {
  vi.clearAllMocks();
  mockUseContentBriefTemplates.mockReturnValue(buildGroupBriefTemplateDraftHookResult());
}

interface TemplateStrictModeBoundaryProps { readonly children: ReactNode; }

export function templateStrictModeBoundary({ children }: TemplateStrictModeBoundaryProps) {
  return createElement(StrictMode, null, children);
}

export function renderGroupBriefTemplateDraft(
  mode: GroupBriefMode = 'create_new_landing_page'
) {
  return renderHook(() => useGroupBriefTemplateDraft(mode));
}

export function renderGroupBriefTemplateDraftInStrictMode(
  mode: GroupBriefMode = 'create_new_landing_page'
) {
  return renderHook(() => useGroupBriefTemplateDraft(mode), {wrapper: templateStrictModeBoundary,});
}

export function renderGroupBriefTemplateDraftWithHooks(
  overrides: Partial<ReturnType<typeof useContentBriefTemplates>> = {},
  mode: GroupBriefMode = 'create_new_landing_page'
) {
  mockUseContentBriefTemplates.mockReturnValue(
    buildGroupBriefTemplateDraftHookResult(overrides)
  );
  return renderGroupBriefTemplateDraft(mode);
}

export function renderGroupBriefTemplateDraftWithHooksInStrictMode(
  overrides: Partial<ReturnType<typeof useContentBriefTemplates>> = {},
  mode: GroupBriefMode = 'create_new_landing_page'
) {
  mockUseContentBriefTemplates.mockReturnValue(
    buildGroupBriefTemplateDraftHookResult(overrides)
  );
  return renderGroupBriefTemplateDraftInStrictMode(mode);
}

export function renderSelectedSavedTemplateDraft(
  overrides: Partial<ReturnType<typeof useContentBriefTemplates>> = {}
) {
  const rendered = renderGroupBriefTemplateDraftWithHooks(overrides);
  act(() => rendered.result.current.select(savedGroupBriefTemplate.id));
  return rendered;
}

export function renderSelectedSavedTemplateDraftInStrictMode(
  overrides: Partial<ReturnType<typeof useContentBriefTemplates>> = {}
) {
  const rendered = renderGroupBriefTemplateDraftWithHooksInStrictMode(overrides);
  act(() => rendered.result.current.select(savedGroupBriefTemplate.id));
  return rendered;
}

export function renderTemplateDraftWithCreateOutcome(
  outcome: ContentBriefTemplateMutationOutcome
) {
  const create = vi.fn().mockResolvedValue(outcome);
  return {
    ...renderGroupBriefTemplateDraftWithHooks({ create }),
    create,
  };
}

export function renderTemplateDraftWithDeferredCreate() {
  const deferred = createDeferredTemplateMutation();
  const create = vi.fn().mockReturnValue(deferred.promise);
  return {
    ...renderGroupBriefTemplateDraftWithHooks({ create }),
    create,
    deferred,
  };
}
