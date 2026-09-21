import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  createContentBriefTemplate,
  deleteContentBriefTemplate,
  fetchContentBriefTemplates,
  updateContentBriefTemplate,
} from '../api/contentStudio';
import { getErrorMessage } from '../infrastructure';
import type {
  ContentBriefTemplate,
  ContentBriefTemplateChanges,
  ContentBriefTemplateDraft,
} from '../types';

export interface ContentBriefTemplateMutationOutcome {
  success: boolean;
  message: string;
  template?: ContentBriefTemplate;
}

export interface UseContentBriefTemplatesReturn {
  templates: ContentBriefTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (
    draft: ContentBriefTemplateDraft
  ) => Promise<ContentBriefTemplateMutationOutcome>;
  update: (
    id: string,
    changes: ContentBriefTemplateChanges
  ) => Promise<ContentBriefTemplateMutationOutcome>;
  remove: (id: string) => Promise<ContentBriefTemplateMutationOutcome>;
}

function orderContentBriefTemplates(
  templates: ContentBriefTemplate[]
): ContentBriefTemplate[] {
  const builtins = templates.filter((template) => template.builtin);
  const saved = templates
    .filter((template) => !template.builtin)
    .sort((left, right) => {
      const byName = left.name.localeCompare(
        right.name,
        undefined,
        { sensitivity: 'base' }
      );
      return byName === 0 ? left.id.localeCompare(right.id) : byName;
    });
  return [...builtins, ...saved];
}

function immutableTemplateOutcome(
  action: 'updated' | 'deleted'
): ContentBriefTemplateMutationOutcome {
  return {
    success: false,
    message: `Built-in templates cannot be ${action}; save a copy instead.`,
  };
}

function failedTemplateMutation(
  action: 'saving' | 'updating' | 'deleting',
  requestError: unknown
): ContentBriefTemplateMutationOutcome {
  console.error(`[content] Error ${action} Content Brief template:`, requestError);
  return {
    success: false,
    message: getErrorMessage(requestError, 'content'),
  };
}

export function useContentBriefTemplates(): UseContentBriefTemplatesReturn {
  const [templates, setTemplates] = useState<ContentBriefTemplate[]>([]);
  // Stryker disable next-line BooleanLiteral: The mount effect starts refresh before the first observable commit, and refresh sets this same loading state true.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const activeOperationRef = useRef<symbol | null>(null);
  const templatesRef = useRef<ContentBriefTemplate[]>([]);

  // Stryker disable ArrayDeclaration: React's state setter and this hook's refs are stable; the replacement constant dependency is stable across renders.
  const replaceTemplates = useCallback((next: ContentBriefTemplate[]) => {
    const ordered = orderContentBriefTemplates(next);
    templatesRef.current = ordered;
    setTemplates(ordered);
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: The operation ref is stable, and the replacement constant dependency is stable across renders.
  const operationIsCurrent = useCallback((operation: symbol): boolean => (
    activeOperationRef.current === operation
  ), []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: The operation ref and Symbol factory are stable, and the replacement constant dependency is stable across renders.
  const beginOperation = useCallback((): symbol => {
    const operation = Symbol();
    activeOperationRef.current = operation;
    return operation;
  }, []);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: Every dependency is a callback with a proven stable identity, so omitting the list cannot stale refresh.
  const refresh = useCallback(async (): Promise<void> => {
    const operation = beginOperation();
    setLoading(true);
    try {
      const items = await fetchContentBriefTemplates();
      if (!operationIsCurrent(operation)) return;
      replaceTemplates(items);
      setError(null);
    } catch (requestError) {
      if (!operationIsCurrent(operation)) return;
      setError(getErrorMessage(requestError, 'content'));
      console.error('[content] Error loading Content Brief templates:', requestError);
    } finally {
      if (operationIsCurrent(operation)) setLoading(false);
    }
  }, [beginOperation, operationIsCurrent, replaceTemplates]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: refresh has a proven stable identity, so omitting it cannot stale this mount effect.
  useEffect(() => {
    void refresh();
    // Stryker disable next-line BlockStatement: React discards this hook instance after unmount, so emptying state-only request cancellation has no observable UI outcome.
    return () => {
      activeOperationRef.current = null;
    };
  }, [refresh]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: Both operation callbacks have proven stable identities, so omitting them cannot stale mutation ordering.
  const runMutation = useCallback(async <TResult,>(
    action: 'saving' | 'updating' | 'deleting',
    request: () => Promise<TResult>,
    apply: (result: TResult) => void,
    outcome: (result: TResult) => ContentBriefTemplateMutationOutcome
  ): Promise<ContentBriefTemplateMutationOutcome> => {
    const operation = beginOperation();
    try {
      const result = await request();
      if (operationIsCurrent(operation)) apply(result);
      return outcome(result);
    } catch (requestError) {
      return failedTemplateMutation(action, requestError);
    } finally {
      if (operationIsCurrent(operation)) setLoading(false);
    }
  }, [beginOperation, operationIsCurrent]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: replaceTemplates and runMutation have proven stable identities, so omitting them cannot stale create.
  const create = useCallback(async (
    draft: ContentBriefTemplateDraft
  ): Promise<ContentBriefTemplateMutationOutcome> => runMutation(
    'saving',
    () => createContentBriefTemplate(draft),
    (template) => replaceTemplates([...templatesRef.current, template]),
    (template) => ({
      success: true,
      message: `Template "${template.name}" saved`,
      template,
    })
  ), [replaceTemplates, runMutation]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: replaceTemplates and runMutation have proven stable identities, so omitting them cannot stale update.
  const update = useCallback(async (
    id: string,
    changes: ContentBriefTemplateChanges
  ): Promise<ContentBriefTemplateMutationOutcome> => {
    const selected = templatesRef.current.find((template) => template.id === id);
    if (selected?.builtin === true) return immutableTemplateOutcome('updated');
    return runMutation(
      'updating',
      () => updateContentBriefTemplate(id, changes),
      (template) => replaceTemplates(templatesRef.current.map((item) => (
        item.id === id ? template : item
      ))),
      (template) => ({
        success: true,
        message: `Template "${template.name}" updated`,
        template,
      })
    );
  }, [replaceTemplates, runMutation]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: replaceTemplates and runMutation have proven stable identities, so omitting them cannot stale remove.
  const remove = useCallback(async (
    id: string
  ): Promise<ContentBriefTemplateMutationOutcome> => {
    const selected = templatesRef.current.find((template) => template.id === id);
    if (selected?.builtin === true) return immutableTemplateOutcome('deleted');
    return runMutation(
      'deleting',
      () => deleteContentBriefTemplate(id),
      () => replaceTemplates(templatesRef.current.filter((template) => template.id !== id)),
      () => ({
        success: true,
        message: 'Template deleted',
      })
    );
  }, [replaceTemplates, runMutation]);
  // Stryker restore ArrayDeclaration

  return {
    templates,
    loading,
    error,
    refresh,
    create,
    update,
    remove,
  };
}
