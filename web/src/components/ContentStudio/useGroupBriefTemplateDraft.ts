import {
  useCallback, useEffect, useMemo, useRef, useState
} from 'react';
import {
  useContentBriefTemplates,
  type ContentBriefTemplateMutationOutcome,
} from '../../hooks/useContentBriefTemplates';
import type {
  ContentBriefTemplate, ContentBriefTemplateDraft, GroupBriefMode
} from '../../types';
import {
  GROUP_BRIEF_BUILTIN_TEMPLATE_IDS,
  GROUP_BRIEF_DEFAULT_TEMPLATES,
} from './GroupBriefForm-source';

interface TemplateDraftState {
  name: string;
  description: string;
  prompt: string;
}

interface TemplateNotice {
  success: boolean;
  message: string;
}

function stateFromTemplate(template: ContentBriefTemplate): TemplateDraftState {
  return {
    name: template.name,
    description: template.description,
    prompt: template.prompt_template,
  };
}

function fallbackState(mode: GroupBriefMode): TemplateDraftState {
  return {
    name: '',
    description: '',
    prompt: GROUP_BRIEF_DEFAULT_TEMPLATES[mode],
  };
}

function templateMutationDraft(
  draft: TemplateDraftState,
  mode: GroupBriefMode
): ContentBriefTemplateDraft {
  return {
    name: draft.name,
    description: draft.description,
    contentAngle: mode,
    promptTemplate: draft.prompt,
  };
}

function templateDraftIsDirty(
  template: ContentBriefTemplate | undefined,
  draft: TemplateDraftState
): boolean {
  return template !== undefined && (
    draft.name !== template.name
    || draft.description !== template.description
    || draft.prompt !== template.prompt_template
  );
}

export function useGroupBriefTemplateDraft(mode: GroupBriefMode) {
  const {
    templates,
    loading,
    error,
    create,
    update,
    remove,
  } = useContentBriefTemplates();
  const [selectedTemplateId, setSelectedTemplateId] = useState(
    GROUP_BRIEF_BUILTIN_TEMPLATE_IDS[mode]
  );
  const [draft, setDraft] = useState<TemplateDraftState>(() => fallbackState(mode));
  const [notice, setNotice] = useState<TemplateNotice | null>(null);
  const [saving, setSaving] = useState(false);
  // Stryker disable next-line BooleanLiteral: The setup effect establishes mounted state before any consumer effect or event can start a mutation.
  const mountedRef = useRef(false);
  const activeOperationRef = useRef<symbol | null>(null);
  const mutationInFlightRef = useRef<symbol | null>(null);
  const selectedTemplate = templates.find((template) => template.id === selectedTemplateId);
  const dirty = useMemo(
    () => templateDraftIsDirty(selectedTemplate, draft),
    [draft, selectedTemplate]
  );

  // Stryker disable ArrayDeclaration: React state setters and stateFromTemplate have stable identities.
  const applyTemplate = useCallback((template: ContentBriefTemplate) => {
    setSelectedTemplateId(template.id);
    setDraft(stateFromTemplate(template));
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This mount lifecycle intentionally runs once per setup and cleanup cycle.
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      // Stryker disable next-line BooleanLiteral: Cleanup and the next setup are synchronous; operation-token clearing is the observable stale-work guard.
      mountedRef.current = false;
      activeOperationRef.current = null;
      mutationInFlightRef.current = null;
    };
  }, []);
  // Stryker restore ArrayDeclaration

  useEffect(() => {
    if (selectedTemplate !== undefined) setDraft(stateFromTemplate(selectedTemplate));
  }, [selectedTemplate]);

  const select = useCallback((templateId: string) => {
    const template = templates.find((item) => item.id === templateId);
    if (template !== undefined) {
      activeOperationRef.current = null;
      applyTemplate(template);
      setNotice(null);
    }
  }, [applyTemplate, templates]);

  // Stryker disable ArrayDeclaration: Refs, state setters, and module-level template maps are stable.
  const selectBuiltin = useCallback((nextMode: GroupBriefMode) => {
    activeOperationRef.current = null;
    const nextId = GROUP_BRIEF_BUILTIN_TEMPLATE_IDS[nextMode];
    setSelectedTemplateId(nextId);
    setDraft(fallbackState(nextMode));
    setNotice(null);
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: This callback closes only over stable refs and React state setters.
  const runMutation = useCallback(async (
    mutation: () => Promise<ContentBriefTemplateMutationOutcome>,
    onSuccess: (template: ContentBriefTemplate | undefined) => void
  ) => {
    if (mutationInFlightRef.current !== null) return;
    const operation = Symbol();
    mutationInFlightRef.current = operation;
    activeOperationRef.current = operation;
    setSaving(true);
    setNotice(null);
    try {
      const outcome = await mutation();
      if (!mountedRef.current || activeOperationRef.current !== operation) return;
      setNotice({
        success: outcome.success,
        message: outcome.message,
      });
      if (outcome.success) onSuccess(outcome.template);
    } finally {
      if (mutationInFlightRef.current === operation) {
        mutationInFlightRef.current = null;
        // Stryker disable next-line ConditionalExpression: React discards state updates after a real unmount, while operation identity handles StrictMode replay.
        if (mountedRef.current) setSaving(false);
      }
    }
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: applyTemplate has a proven stable identity.
  const applyReturnedTemplate = useCallback((
    template: ContentBriefTemplate | undefined
  ) => {
    if (template !== undefined) applyTemplate(template);
  }, [applyTemplate]);
  // Stryker restore ArrayDeclaration

  const saveAsNew = useCallback(async () => runMutation(
    () => create(templateMutationDraft(draft, mode)),
    applyReturnedTemplate
  ), [applyReturnedTemplate, create, draft, mode, runMutation]);

  const updateSelected = useCallback(async () => runMutation(
    () => update(selectedTemplateId, templateMutationDraft(draft, mode)),
    applyReturnedTemplate
  ), [applyReturnedTemplate, draft, mode, runMutation, selectedTemplateId, update]);

  const deleteSelected = useCallback(async () => {
    if (selectedTemplate === undefined || selectedTemplate.builtin) return;
    const confirmed = globalThis.confirm(
      `Delete template "${selectedTemplate.name}"? Existing briefs keep their prompt snapshot.`
    );
    if (!confirmed) return;
    await runMutation(
      () => remove(selectedTemplate.id),
      () => selectBuiltin(mode)
    );
  }, [mode, remove, runMutation, selectBuiltin, selectedTemplate]);

  const reset = useCallback(() => {
    if (selectedTemplate !== undefined) applyTemplate(selectedTemplate);
  }, [applyTemplate, selectedTemplate]);

  // Stryker disable ArrayDeclaration: React's state setter has a stable identity.
  const setName = useCallback((name: string) => {
    setDraft((current) => ({
      ...current,
      name,
    }));
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: React's state setter has a stable identity.
  const setDescription = useCallback((description: string) => {
    setDraft((current) => ({
      ...current,
      description,
    }));
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: React's state setter has a stable identity.
  const setPrompt = useCallback((prompt: string) => {
    setDraft((current) => ({
      ...current,
      prompt,
    }));
  }, []);
  // Stryker restore ArrayDeclaration

  return {
    templates,
    loading,
    error,
    selectedTemplateId,
    selectedTemplate,
    draft,
    notice,
    saving,
    dirty,
    select,
    selectBuiltin,
    reset,
    saveAsNew,
    updateSelected,
    deleteSelected,
    setName,
    setDescription,
    setPrompt,
  };
}
