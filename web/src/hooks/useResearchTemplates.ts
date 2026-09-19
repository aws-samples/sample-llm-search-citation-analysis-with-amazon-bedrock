import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  createResearchTemplate,
  deleteResearchTemplate,
  fetchResearchTemplates,
  updateResearchTemplate,
} from '../api/keywordResearch';
import type {
  TemplateChanges, TemplateDraft
} from '../api/keywordResearch';
import { getErrorMessage } from '../infrastructure';
import type { ResearchTemplate } from '../types';

export interface TemplateMutationOutcome {
  success: boolean;
  message: string;
  template?: ResearchTemplate;
}

interface UseResearchTemplatesReturn {
  templates: ResearchTemplate[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  create: (draft: TemplateDraft) => Promise<TemplateMutationOutcome>;
  update: (id: string, changes: TemplateChanges) => Promise<TemplateMutationOutcome>;
  remove: (id: string) => Promise<TemplateMutationOutcome>;
}

/**
 * The API's order: built-ins first, as the API lists them (hotels,
 * restaurants, …), then the saved templates by name. Applied after local
 * mutations so a saved or renamed template lands where a reload would put it.
 */
function orderTemplates(templates: ResearchTemplate[]): ResearchTemplate[] {
  const builtins = templates.filter((template) => template.builtin);
  const saved = templates
    .filter((template) => !template.builtin)
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
  return [...builtins, ...saved];
}

/**
 * The research agent's templates (industry profiles): the built-ins plus the
 * ones the team saved. Mutations update the list in place (the API answers
 * with the saved row) so the editor never shows a stale template.
 */
export const useResearchTemplates = (): UseResearchTemplatesReturn => {
  const [templates, setTemplates] = useState<ResearchTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const items = await fetchResearchTemplates();
      if (!mountedRef.current) return;
      setTemplates(orderTemplates(items));
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(getErrorMessage(err, 'research'));
      console.error('[research] Error loading templates:', err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  // Load once on mount; the mount flag keeps a late answer from touching an unmounted editor.
  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
    };
  }, [refresh]);

  const create = useCallback(async (draft: TemplateDraft): Promise<TemplateMutationOutcome> => {
    try {
      const template = await createResearchTemplate(draft);
      if (mountedRef.current) setTemplates((prev) => orderTemplates([...prev, template]));
      return {
        success: true,
        message: `Template "${template.name}" saved`,
        template,
      };
    } catch (err) {
      console.error('[research] Error saving template:', err);
      return {
        success: false,
        message: getErrorMessage(err, 'research'),
      };
    }
  }, []);

  const update = useCallback(async (id: string, changes: TemplateChanges): Promise<TemplateMutationOutcome> => {
    try {
      const template = await updateResearchTemplate(id, changes);
      if (mountedRef.current) {
        setTemplates((prev) => orderTemplates(prev.map((item) => (item.id === id ? template : item))));
      }
      return {
        success: true,
        message: `Template "${template.name}" updated`,
        template,
      };
    } catch (err) {
      console.error('[research] Error updating template:', err);
      return {
        success: false,
        message: getErrorMessage(err, 'research'),
      };
    }
  }, []);

  const remove = useCallback(async (id: string): Promise<TemplateMutationOutcome> => {
    try {
      await deleteResearchTemplate(id);
      if (mountedRef.current) setTemplates((prev) => prev.filter((item) => item.id !== id));
      return {
        success: true,
        message: 'Template deleted',
      };
    } catch (err) {
      console.error('[research] Error deleting template:', err);
      return {
        success: false,
        message: getErrorMessage(err, 'research'),
      };
    }
  }, []);

  return {
    templates,
    loading,
    error,
    refresh,
    create,
    update,
    remove,
  };
};
