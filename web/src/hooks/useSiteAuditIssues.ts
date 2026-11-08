import {
  useCallback, useEffect, useRef, useState
} from 'react';
import {
  fetchIssuePages, fetchIssueTypes
} from '../api/seoAudits';
import { seoErrorMessage } from '../api/seo';
import type {
  AuditIssue, IssueTypeEntry
} from '../types/api/seoAudits';
import {
  useSiteAuditLoad, type SiteAuditLoad
} from './useSiteAuditLoad';

/** The issue types a finished audit found, with their registry text; `null` (not finished) loads nothing. */
export function useSiteAuditIssueTypes(auditId: string | null): SiteAuditLoad<IssueTypeEntry[]> {
  const load = useCallback(
    async (signal: AbortSignal) => (await fetchIssueTypes(auditId ?? '', { signal })).issue_types,
    [auditId]
  );
  return useSiteAuditLoad(auditId, load);
}

export interface AffectedPages {
  readonly items: readonly AuditIssue[];
  readonly loading: boolean;
  readonly error: string | null;
  readonly hasMore: boolean;
  readonly loadMore: () => void;
}

interface PagesState {
  items: AuditIssue[];
  nextToken: string | null;
  loading: boolean;
  error: string | null;
}

const EMPTY: PagesState = {
  items: [],
  nextToken: null,
  loading: false,
  error: null,
};

/** The pages one issue type affects, read 50 at a time; `issueType` `null` (drawer closed) reads nothing. */
export function useAffectedPages(auditId: string, issueType: string | null): AffectedPages {
  const [pages, setPages] = useState<PagesState>(EMPTY);
  const controllerRef = useRef<AbortController | null>(null);

  const read = useCallback(async (nextToken: string | null, append: boolean) => {
    if (issueType === null) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setPages((current) => ({
      ...(append ? current : EMPTY),
      loading: true,
      error: null,
    }));
    try {
      const answer = await fetchIssuePages(auditId, issueType, nextToken, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setPages((current) => ({
        items: append ? [...current.items, ...answer.items] : answer.items,
        nextToken: answer.next_token,
        loading: false,
        error: null,
      }));
    } catch (failure) {
      if (controller.signal.aborted) return;
      setPages((current) => ({
        ...current,
        loading: false,
        error: seoErrorMessage(failure),
      }));
    }
  }, [auditId, issueType]);

  useEffect(() => {
    if (issueType === null) {
      setPages(EMPTY);
      return undefined;
    }
    void read(null, false);
    return () => controllerRef.current?.abort();
  }, [issueType, read]);

  const { nextToken } = pages;
  const loadMore = useCallback(() => {
    if (nextToken !== null) void read(nextToken, true);
  }, [nextToken, read]);

  return {
    items: pages.items,
    loading: pages.loading,
    error: pages.error,
    hasMore: nextToken !== null,
    loadMore,
  };
}
