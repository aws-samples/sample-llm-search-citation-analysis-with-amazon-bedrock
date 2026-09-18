import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  getErrorMessage, isAbortError
} from '../infrastructure';
import type {
  Keyword, KeywordGroup
} from '../types';
import {
  createKeywordGroup,
  deleteKeywordGroup,
  fetchKeywordGroups,
  mergeUpdatedKeywords,
  updateGroupMemberships,
  updateKeywordGroup,
} from '../api/keywordGroups';
import type { MembershipChanges } from '../api/keywordGroups';

export interface MutationOutcome {
  success: boolean;
  message: string;
}

interface UseKeywordGroupsOptions {
  /** Called with the keyword items the API returns after a membership change. */
  onKeywordsUpdated?: (updated: Keyword[]) => void;
}

interface UseKeywordGroupsReturn {
  groups: KeywordGroup[];
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  createGroup: (name: string, description?: string) => Promise<MutationOutcome>;
  renameGroup: (id: string, name: string) => Promise<MutationOutcome>;
  removeGroup: (id: string) => Promise<MutationOutcome>;
  changeMemberships: (id: string, changes: MembershipChanges) => Promise<MutationOutcome>;
}

function sortGroups(groups: KeywordGroup[]): KeywordGroup[] {
  return [...groups].sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
}

/**
 * Keyword groups (folders) with their member counts, plus the mutations the
 * Settings panel and the execution picker need. Every mutation refreshes the
 * list so counts stay authoritative.
 */
export const useKeywordGroups = (options: UseKeywordGroupsOptions = {}): UseKeywordGroupsReturn => {
  const { onKeywordsUpdated } = options;
  const [groups, setGroups] = useState<KeywordGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);
  const controllerRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    try {
      const fetched = await fetchKeywordGroups(controller.signal);
      if (!mountedRef.current || controllerRef.current !== controller) return;
      setGroups(sortGroups(fetched));
      setError(null);
    } catch (fetchError) {
      if (isAbortError(fetchError) || !mountedRef.current) return;
      console.error('[keyword-groups] Error fetching groups:', fetchError);
      setError(getErrorMessage(fetchError, 'keywords'));
    } finally {
      if (mountedRef.current && controllerRef.current === controller) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refresh();
    return () => {
      mountedRef.current = false;
      controllerRef.current?.abort();
    };
  }, [refresh]);

  const runMutation = useCallback(async (
    action: () => Promise<void>,
    successMessage: string,
    context: string
  ): Promise<MutationOutcome> => {
    try {
      await action();
      await refresh();
      return {
        success: true,
        message: successMessage
      };
    } catch (mutationError) {
      console.error(`[keyword-groups] ${context} failed:`, mutationError);
      return {
        success: false,
        message: getErrorMessage(mutationError, 'keywords')
      };
    }
  }, [refresh]);

  const createGroup = useCallback(
    (name: string, description = '') => runMutation(
      async () => { await createKeywordGroup(name, description); },
      `Group "${name}" created`,
      'create'
    ),
    [runMutation]
  );

  const renameGroup = useCallback(
    (id: string, name: string) => runMutation(
      async () => { await updateKeywordGroup(id, { name }); },
      `Group renamed to "${name}"`,
      'rename'
    ),
    [runMutation]
  );

  const removeGroup = useCallback(
    (id: string) => runMutation(
      async () => { await deleteKeywordGroup(id); },
      'Group deleted',
      'delete'
    ),
    [runMutation]
  );

  const changeMemberships = useCallback(
    (id: string, changes: MembershipChanges) => runMutation(
      async () => {
        const result = await updateGroupMemberships(id, changes);
        onKeywordsUpdated?.(result.keywords);
      },
      'Group membership updated',
      'membership change'
    ),
    [runMutation, onKeywordsUpdated]
  );

  return {
    groups,
    loading,
    error,
    refresh,
    createGroup,
    renameGroup,
    removeGroup,
    changeMemberships,
  };
};

export { mergeUpdatedKeywords };
