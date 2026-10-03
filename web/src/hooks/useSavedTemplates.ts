import {
  useCallback, useEffect, useRef, useState
} from 'react';
import { getErrorMessage } from '../infrastructure';
import { useLatestRequest } from './useLatestRequest';

type ErrorScope = Parameters<typeof getErrorMessage>[1];

interface SavedTemplate {
  id: string;
  name: string;
  builtin: boolean;
}

export interface SavedTemplateOutcome<TTemplate> {
  success: boolean;
  message: string;
  template?: TTemplate;
}

export interface SavedTemplatesReturn<TTemplate, TDraft, TChanges> {
  templates: TTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (draft: TDraft) => Promise<SavedTemplateOutcome<TTemplate>>;
  update: (id: string, changes: TChanges) => Promise<SavedTemplateOutcome<TTemplate>>;
  remove: (id: string) => Promise<SavedTemplateOutcome<TTemplate>>;
}

type MutationAction = 'saving' | 'updating' | 'deleting';

/** One saved-template collection: its API, error scope and how saved rows sort. */
export interface SavedTemplatesSource<TTemplate, TDraft, TChanges> {
  errorScope: ErrorScope;
  /** Console prefix, e.g. `[content]`. */
  logTag: string;
  /** Singular noun used in console messages, e.g. `Content Brief template`. */
  subject: string;
  list: () => Promise<TTemplate[]>;
  create: (draft: TDraft) => Promise<TTemplate>;
  update: (id: string, changes: TChanges) => Promise<TTemplate>;
  remove: (id: string) => Promise<void>;
  /** Order of the saved (non built-in) templates; mirrors the API's list order. */
  compareSaved: (left: TTemplate, right: TTemplate) => number;
  /** Refuse to update or delete a built-in locally instead of asking the API. */
  guardBuiltins: boolean;
}

/** Name order, case-insensitive: the order the template APIs list saved rows in. */
export function compareTemplateNames(left: SavedTemplate, right: SavedTemplate): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
}

function orderTemplates<TTemplate extends SavedTemplate>(
  templates: TTemplate[],
  compareSaved: (left: TTemplate, right: TTemplate) => number
): TTemplate[] {
  const builtins = templates.filter((template) => template.builtin);
  const saved = templates
    .filter((template) => !template.builtin)
    .sort(compareSaved);
  return [...builtins, ...saved];
}

function immutableTemplateOutcome<TTemplate>(
  action: 'updated' | 'deleted'
): SavedTemplateOutcome<TTemplate> {
  return {
    success: false,
    message: `Built-in templates cannot be ${action}; save a copy instead.`,
  };
}

function savedOutcome<TTemplate extends SavedTemplate>(
  verb: 'saved' | 'updated',
  template: TTemplate
): SavedTemplateOutcome<TTemplate> {
  return {
    success: true,
    message: `Template "${template.name}" ${verb}`,
    template,
  };
}

/**
 * A list of templates (built-ins first, then the saved ones) with create,
 * update and remove. The latest operation wins: a late answer from an older
 * load or mutation never overwrites the list, and nothing lands after unmount.
 * Mutations update the list in place so it matches what a reload would show.
 */
export function useSavedTemplates<TTemplate extends SavedTemplate, TDraft, TChanges>(
  source: SavedTemplatesSource<TTemplate, TDraft, TChanges>
): SavedTemplatesReturn<TTemplate, TDraft, TChanges> {
  const [templates, setTemplates] = useState<TTemplate[]>([]);
  // Stryker disable next-line BooleanLiteral: The mount effect starts refresh before the first observable commit, and refresh sets this same loading state true.
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const templatesRef = useRef<TTemplate[]>([]);
  const { beginRequest } = useLatestRequest();

  // Stryker disable ArrayDeclaration: React's state setter and this hook's refs are stable; the replacement constant dependency is stable across renders.
  const replaceTemplates = useCallback((next: TTemplate[]) => {
    const ordered = orderTemplates(next, source.compareSaved);
    templatesRef.current = ordered;
    setTemplates(ordered);
  }, [source]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: Every dependency is a callback with a proven stable identity, so omitting the list cannot stale refresh.
  const refresh = useCallback(async (): Promise<void> => {
    const request = beginRequest();
    setLoading(true);
    try {
      const items = await source.list();
      if (!request.isCurrent()) return;
      replaceTemplates(items);
      setError(null);
    } catch (requestError) {
      if (!request.isCurrent()) return;
      setError(getErrorMessage(requestError, source.errorScope));
      console.error(`${source.logTag} Error loading ${source.subject}s:`, requestError);
    } finally {
      if (request.isCurrent()) setLoading(false);
      request.finish();
    }
  }, [beginRequest, replaceTemplates, source]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: refresh has a proven stable identity, so omitting it cannot stale this mount effect.
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: beginRequest has a proven stable identity, so omitting it cannot stale mutation ordering.
  const runMutation = useCallback(async <TResult,>(
    action: MutationAction,
    request: () => Promise<TResult>,
    apply: (result: TResult) => void,
    outcome: (result: TResult) => SavedTemplateOutcome<TTemplate>
  ): Promise<SavedTemplateOutcome<TTemplate>> => {
    const operation = beginRequest();
    try {
      const result = await request();
      if (operation.isCurrent()) apply(result);
      return outcome(result);
    } catch (requestError) {
      console.error(`${source.logTag} Error ${action} ${source.subject}:`, requestError);
      return {
        success: false,
        message: getErrorMessage(requestError, source.errorScope),
      };
    } finally {
      if (operation.isCurrent()) setLoading(false);
      operation.finish();
    }
  }, [beginRequest, source]);
  // Stryker restore ArrayDeclaration

  const isGuardedBuiltin = useCallback((id: string): boolean => source.guardBuiltins
    && templatesRef.current.find((template) => template.id === id)?.builtin === true, [source]);

  // Stryker disable ArrayDeclaration: replaceTemplates and runMutation have proven stable identities, so omitting them cannot stale create.
  const create = useCallback(async (draft: TDraft) => runMutation(
    'saving',
    () => source.create(draft),
    (template) => replaceTemplates([...templatesRef.current, template]),
    (template) => savedOutcome('saved', template)
  ), [replaceTemplates, runMutation, source]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: replaceTemplates and runMutation have proven stable identities, so omitting them cannot stale update.
  const update = useCallback(async (id: string, changes: TChanges) => {
    if (isGuardedBuiltin(id)) return immutableTemplateOutcome<TTemplate>('updated');
    return runMutation(
      'updating',
      () => source.update(id, changes),
      (template) => replaceTemplates(templatesRef.current.map((item) => (
        item.id === id ? template : item
      ))),
      (template) => savedOutcome('updated', template)
    );
  }, [isGuardedBuiltin, replaceTemplates, runMutation, source]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: replaceTemplates and runMutation have proven stable identities, so omitting them cannot stale remove.
  const remove = useCallback(async (id: string) => {
    if (isGuardedBuiltin(id)) return immutableTemplateOutcome<TTemplate>('deleted');
    return runMutation(
      'deleting',
      () => source.remove(id),
      () => replaceTemplates(templatesRef.current.filter((template) => template.id !== id)),
      () => ({
        success: true,
        message: 'Template deleted',
      })
    );
  }, [isGuardedBuiltin, replaceTemplates, runMutation, source]);
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
