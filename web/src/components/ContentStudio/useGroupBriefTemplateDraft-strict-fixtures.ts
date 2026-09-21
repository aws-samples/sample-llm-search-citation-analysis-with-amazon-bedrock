import {
  useEffect, useRef
} from 'react';
import { renderHook } from '@testing-library/react';
import { vi } from 'vitest';
import {
  buildGroupBriefTemplateDraftHookResult,
  createDeferredTemplateMutation,
  mockUseContentBriefTemplates,
  templateStrictModeBoundary,
} from './useGroupBriefTemplateDraft-fixtures';
import { useGroupBriefTemplateDraft } from './useGroupBriefTemplateDraft';

function useTemplateCreateOnMount() {
  const templateDraft = useGroupBriefTemplateDraft('create_new_landing_page');
  const saveOnMount = useRef(templateDraft.saveAsNew).current;
  useEffect(() => {
    void saveOnMount();
  }, [saveOnMount]);
  return templateDraft;
}

export function renderReplayedTemplateCreate() {
  const firstCreate = createDeferredTemplateMutation();
  const secondCreate = createDeferredTemplateMutation();
  const create = vi.fn()
    .mockReturnValueOnce(firstCreate.promise)
    .mockReturnValueOnce(secondCreate.promise);
  mockUseContentBriefTemplates.mockReturnValue(
    buildGroupBriefTemplateDraftHookResult({ create })
  );
  return {
    ...renderHook(
      () => useTemplateCreateOnMount(),
      {wrapper: templateStrictModeBoundary,}
    ),
    create,
    firstCreate,
    secondCreate,
  };
}
