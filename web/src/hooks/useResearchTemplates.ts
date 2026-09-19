import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  createResearchTemplate,
  deleteResearchTemplate,
  fetchResearchTemplates,
  updateResearchTemplate,
} from '../api/keywordResearch';
import type { TemplateDraft } from '../api/keywordResearch';
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
  update: (id: string, changes: Partial<TemplateDraft>) => Promise<TemplateMutationOutcome>;
  remove: (id: string) => Promise<TemplateMutationOutcome>;
}

function sortTemplates(templates: ResearchTemplate[]): ResearchTemplate[] {
  return [...templates].sort((left, right) => {
    if (left.builtin !== right.builtin) return left.builtin ? -1 : 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

/**
 * The research agent's system-prompt templates: the built-in one plus the
 * ones the team saved. Mutations update the list in place (the API answers
 * with the saved row) so the editor never shows a stale prompt.
 */
export const useResearchTemplates = (): UseResearchTemplatesReturn => {
  const [templates, setTemplates] = useState<ResearchTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const refresh = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      const items = await fetchResearchTemplates();
      if (!mountedRef.current) return;
      setTemplates(sortTemplates(items));
      setError(null);
    } catch (err) {
      if (!mountedRef.current) return;
      setError(getErrorMessage(err, 'research'));
      console.error('[research] Error loading templates:', err);
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(async (draft: TemplateDraft): Promise<TemplateMutationOutcome> => {
    try {
      const template = await createResearchTemplate(draft);
      if (mountedRef.current) setTemplates((prev) => sortTemplates([...prev, template]));
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

  const update = useCallback(async (id: string, changes: Partial<TemplateDraft>): Promise<TemplateMutationOutcome> => {
    try {
      const template = await updateResearchTemplate(id, changes);
      if (mountedRef.current) {
        setTemplates((prev) => sortTemplates(prev.map((item) => (item.id === id ? template : item))));
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
