/**
 * Hook for managing query prompt templates (personas).
 */
import {
  useState, useCallback, useEffect 
} from 'react';
import {
  authenticatedFetch, API_BASE_URL 
} from '../infrastructure';
import type { QueryPrompt } from '../types';

class QueryPromptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QueryPromptError';
  }
}

export function useQueryPrompts() {
  const [prompts, setPrompts] = useState<QueryPrompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchPrompts = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await authenticatedFetch(`${API_BASE_URL}/query-prompts`);
      if (!response.ok) throw new QueryPromptError(`HTTP ${response.status}`);
      const data: unknown = await response.json();
      setPrompts(Array.isArray(data) ? data as QueryPrompt[] : []);
    } catch (err) {
      console.warn('Could not fetch query prompts:', err);
      setPrompts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPrompts();
  }, [fetchPrompts]);

  const createPrompt = useCallback(async (name: string, template: string, description?: string) => {
    setError(null);
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/query-prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          template,
          ...(description ? { description } : {}),
        }),
      });
      if (!response.ok) throw new QueryPromptError(`HTTP ${response.status}`);
      const created = await response.json() as QueryPrompt;
      setPrompts(prev => [created, ...prev]);
      return created;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to create prompt';
      setError(msg);
      throw err;
    }
  }, []);

  /** PUT or PATCH one prompt and swap the server's updated copy into the list. */
  const replacePrompt = useCallback(async (id: string, init: RequestInit): Promise<QueryPrompt> => {
    const response = await authenticatedFetch(`${API_BASE_URL}/query-prompts/${id}`, init);
    if (!response.ok) throw new QueryPromptError(`HTTP ${response.status}`);
    const updated = await response.json() as QueryPrompt;
    setPrompts(prev => prev.map(p => p.id === id ? updated : p));
    return updated;
  }, []);

  const updatePrompt = useCallback(async (id: string, updates: {
    name?: string;
    template?: string;
    description?: string;
  }) => {
    setError(null);
    try {
      return await replacePrompt(id, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to update prompt';
      setError(msg);
      throw err;
    }
  }, [replacePrompt]);

  const deletePrompt = useCallback(async (id: string) => {
    setError(null);
    try {
      const response = await authenticatedFetch(`${API_BASE_URL}/query-prompts/${id}`, {method: 'DELETE',});
      if (!response.ok) throw new QueryPromptError(`HTTP ${response.status}`);
      setPrompts(prev => prev.filter(p => p.id !== id));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to delete prompt';
      setError(msg);
      throw err;
    }
  }, []);

  const togglePrompt = useCallback(async (id: string) => {
    setError(null);
    try {
      return await replacePrompt(id, { method: 'PATCH' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle prompt';
      setError(msg);
      throw err;
    }
  }, [replacePrompt]);

  return {
    prompts,
    loading,
    error,
    fetchPrompts,
    createPrompt,
    updatePrompt,
    deletePrompt,
    togglePrompt,
  };
}
