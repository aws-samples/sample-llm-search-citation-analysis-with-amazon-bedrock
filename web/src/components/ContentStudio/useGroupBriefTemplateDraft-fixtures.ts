import {
  StrictMode, createElement, type ReactNode
} from 'react';
import {
  act, renderHook, waitFor, type RenderHookResult
} from '@testing-library/react';
import {
  expect, vi
} from 'vitest';
import {
  useContentBriefTemplates,
  type ContentBriefTemplateMutationOutcome,
} from '../../hooks/useContentBriefTemplates';
import type {
  ContentBriefTemplate, GroupBriefMode
} from '../../types';
import { GROUP_BRIEF_DEFAULT_TEMPLATES } from './GroupBriefForm-source';
import {
  buildContentBriefTemplate,
  buildContentBriefTemplatesHookResult,
} from './GroupBriefForm-fixtures';
import { useGroupBriefTemplateDraft } from './useGroupBriefTemplateDraft';

type TemplatesHookResult = ReturnType<typeof useContentBriefTemplates>;
type TemplateDraftResult = ReturnType<typeof useGroupBriefTemplateDraft>;
type TemplateDraftRender = RenderHookResult<TemplateDraftResult, unknown>;

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

export const saveFailedOutcome = {
  success: false,
  message: 'Save failed',
} satisfies ContentBriefTemplateMutationOutcome;

export const templateDeletedOutcome = {
  success: true,
  message: 'Template deleted',
} satisfies ContentBriefTemplateMutationOutcome;

export function buildTemplateSavedOutcome(
  template: ContentBriefTemplate
): ContentBriefTemplateMutationOutcome {
  return {
    success: true,
    message: 'Template saved',
    template,
  };
}

export function buildFallbackTemplateDraft(mode: GroupBriefMode) {
  return {
    name: '',
    description: '',
    prompt: GROUP_BRIEF_DEFAULT_TEMPLATES[mode],
  };
}

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
  overrides: Partial<TemplatesHookResult> = {}
): TemplatesHookResult {
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

interface TemplateDraftRenderOptions {
  readonly mode?: GroupBriefMode;
  readonly strict?: boolean;
}

export function renderGroupBriefTemplateDraft({
  mode = 'create_new_landing_page',
  strict = false,
}: TemplateDraftRenderOptions = {}): TemplateDraftRender {
  const wrapper = strict ? templateStrictModeBoundary : undefined;
  return renderHook(() => useGroupBriefTemplateDraft(mode), { wrapper });
}

export function renderGroupBriefTemplateDraftWithHooks(
  overrides: Partial<TemplatesHookResult> = {},
  options: TemplateDraftRenderOptions = {}
): TemplateDraftRender {
  mockUseContentBriefTemplates.mockReturnValue(
    buildGroupBriefTemplateDraftHookResult(overrides)
  );
  return renderGroupBriefTemplateDraft(options);
}

export function renderGroupBriefTemplateDraftAcrossTemplateRefresh(
  initial: Partial<TemplatesHookResult>,
  refreshed: TemplatesHookResult
): TemplateDraftRender {
  mockUseContentBriefTemplates.mockReturnValue(buildContentBriefTemplatesHookResult(initial));
  const rendered = renderGroupBriefTemplateDraft();
  mockUseContentBriefTemplates.mockReturnValue(refreshed);
  rendered.rerender();
  return rendered;
}

export function renderSelectedSavedTemplateDraft(
  overrides: Partial<TemplatesHookResult> = {},
  options: TemplateDraftRenderOptions = {}
): TemplateDraftRender {
  const rendered = renderGroupBriefTemplateDraftWithHooks(overrides, options);
  act(() => rendered.result.current.select(savedGroupBriefTemplate.id));
  return rendered;
}

export function renderTemplateDraftWithCreateOutcome(
  outcome: ContentBriefTemplateMutationOutcome,
  options: TemplateDraftRenderOptions = {}
) {
  const create = vi.fn().mockResolvedValue(outcome);
  return {
    ...renderGroupBriefTemplateDraftWithHooks({ create }, options),
    create,
  };
}

export function renderSelectedTemplateDraftWithUpdateOutcome(
  outcome: ContentBriefTemplateMutationOutcome,
  options: TemplateDraftRenderOptions = {}
) {
  const update = vi.fn().mockResolvedValue(outcome);
  return {
    ...renderSelectedSavedTemplateDraft({ update }, options),
    update,
  };
}

interface SavedTemplateDeletionOptions extends TemplateDraftRenderOptions {
  readonly confirmed: boolean;
  readonly outcome?: ContentBriefTemplateMutationOutcome;
}

export function renderSelectedTemplateDraftForDeletion({
  confirmed,
  outcome = templateDeletedOutcome,
  ...options
}: SavedTemplateDeletionOptions) {
  const remove = vi.fn().mockResolvedValue(outcome);
  const confirmSpy = vi.spyOn(globalThis, 'confirm').mockReturnValue(confirmed);
  return {
    ...renderSelectedSavedTemplateDraft({ remove }, options),
    confirmSpy,
    remove,
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

interface TemplateDraftFields {
  readonly name: string;
  readonly description: string;
  readonly prompt: string;
}

export function fillTemplateDraftFields(
  draft: TemplateDraftResult,
  fields: TemplateDraftFields
): void {
  act(() => {
    draft.setName(fields.name);
    draft.setDescription(fields.description);
    draft.setPrompt(fields.prompt);
  });
}

export async function waitForTemplateSavingToSettle(
  rendered: Pick<TemplateDraftRender, 'result'>
): Promise<void> {
  await waitFor(() => {
    expect(rendered.result.current.saving).toBe(false);
  });
}
