import {
  useCallback, useEffect, useMemo, useRef
} from 'react';
import { getErrorMessage } from '../infrastructure';
import {
  useGuardedLoad, type GuardedLoadSource
} from './useGuardedLoad';

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

/** The guarded load of `source`'s list, ordered as the hook shows it. */
function templatesLoad<TTemplate extends SavedTemplate, TDraft, TChanges>(
  source: SavedTemplatesSource<TTemplate, TDraft, TChanges>
): GuardedLoadSource<TTemplate[]> {
  return {
    initial: [],
    load: async () => orderTemplates(await source.list(), source.compareSaved),
    errorMessage: (failure) => getErrorMessage(failure, source.errorScope),
    logMessage: `${source.logTag} Error loading ${source.subject}s:`,
  };
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

/** The list with `template` added. */
function appended<TTemplate>(template: TTemplate): (templates: TTemplate[]) => TTemplate[] {
  return (templates) => [...templates, template];
}

/** The list with the template at `id` replaced by `template`. */
function replaced<TTemplate extends SavedTemplate>(id: string, template: TTemplate): (templates: TTemplate[]) => TTemplate[] {
  return (templates) => templates.map((item) => (item.id === id ? template : item));
}

/** The list without the template at `id`. */
function removed<TTemplate extends SavedTemplate>(id: string): (templates: TTemplate[]) => TTemplate[] {
  return (templates) => templates.filter((item) => item.id !== id);
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
  // Stryker disable next-line ArrayDeclaration: source is the caller's module-level constant, so omitting it cannot stale the load.
  const listing = useMemo(() => templatesLoad(source), [source]);
  const {
    data: templates, loading, error, reload: refresh, setData: setTemplates, mutate
  } = useGuardedLoad(listing);
  // The built-in guard reads the list synchronously, outside React's render.
  const templatesRef = useRef(templates);
  useEffect(() => {
    templatesRef.current = templates;
  }, [templates]);

  // Stryker disable ArrayDeclaration: React's state setter is stable and source is the caller's module-level constant, so omitting them cannot stale replaceTemplates.
  const replaceTemplates = useCallback((edit: (current: TTemplate[]) => TTemplate[]) => {
    setTemplates((current) => orderTemplates(edit(current), source.compareSaved));
  }, [setTemplates, source]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: mutate has a proven stable identity and source is the caller's constant, so omitting them cannot stale mutation ordering.
  const runMutation = useCallback(async <TResult,>(
    action: MutationAction,
    request: () => Promise<TResult>,
    apply: (result: TResult) => void,
    outcome: (result: TResult) => SavedTemplateOutcome<TTemplate>
  ): Promise<SavedTemplateOutcome<TTemplate>> => {
    try {
      return outcome(await mutate(request, apply));
    } catch (requestError) {
      console.error(`${source.logTag} Error ${action} ${source.subject}:`, requestError);
      return {
        success: false,
        message: getErrorMessage(requestError, source.errorScope),
      };
    }
  }, [mutate, source]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: React dependency list; source is the caller's module-level constant, so omitting it cannot stale the guard
  const isGuardedBuiltin = useCallback((id: string): boolean => source.guardBuiltins
    && templatesRef.current.find((template) => template.id === id)?.builtin === true, [source]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: replaceTemplates and runMutation have proven stable identities, so omitting them cannot stale create.
  const create = useCallback(async (draft: TDraft) => runMutation(
    'saving',
    () => source.create(draft),
    (template) => replaceTemplates(appended(template)),
    (template) => savedOutcome('saved', template)
  ), [replaceTemplates, runMutation, source]);
  // Stryker restore ArrayDeclaration

  // Stryker disable ArrayDeclaration: replaceTemplates and runMutation have proven stable identities, so omitting them cannot stale update.
  const update = useCallback(async (id: string, changes: TChanges) => {
    if (isGuardedBuiltin(id)) return immutableTemplateOutcome<TTemplate>('updated');
    return runMutation(
      'updating',
      () => source.update(id, changes),
      (template) => replaceTemplates(replaced(id, template)),
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
      () => replaceTemplates(removed(id)),
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
