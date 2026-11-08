import {
  useCallback, useRef, useState
} from 'react';
import type {
  Dispatch, SetStateAction
} from 'react';
import { fetchContentIdeas } from '../api/contentStudio';
import type { ContentIdeasPageInfo } from '../api/contentStudioDecoders';
import type { ContentIdea } from '../types';
import { appendHistoryPage } from './useContentHistoryPaging';

export interface ContentIdeasPaging {
  /** Every idea of the scope, once the first page said so. */
  readonly ideasTotal: number | null;
  readonly ideasHasMore: boolean;
  readonly ideasLoadingMore: boolean;
  /** Stores where a freshly read first page sits, and the query its next pages repeat. */
  readonly applyFirstPage: (params: Readonly<Record<string, string>>, page: ContentIdeasPageInfo) => void;
  /** Appends the next page of ideas (same scope and market). */
  readonly loadMoreIdeas: () => Promise<void>;
}

/**
 * The ideas past the first page (2.45.0 wave 5: `/content-studio/ideas` pages every idea of the
 * scope over `ideas_next_token`), loaded on demand below the first page.
 */
export function useContentIdeasPaging(
  setIdeas: Dispatch<SetStateAction<ContentIdea[]>>,
  onError: (error: unknown) => void,
): ContentIdeasPaging {
  const [nextToken, setNextToken] = useState<string | null>(null);
  const [ideasTotal, setIdeasTotal] = useState<number | null>(null);
  const [ideasLoadingMore, setIdeasLoadingMore] = useState(false);
  const paramsRef = useRef<Readonly<Record<string, string>>>({});

  const applyFirstPage = useCallback((params: Readonly<Record<string, string>>, page: ContentIdeasPageInfo) => {
    paramsRef.current = params;
    setNextToken(page.nextToken);
    setIdeasTotal(page.total);
  }, []);

  const loadMoreIdeas = useCallback(async () => {
    if (nextToken === null) return;
    setIdeasLoadingMore(true);
    try {
      const pageInfo: { current: ContentIdeasPageInfo | null } = { current: null };
      const page = await fetchContentIdeas(undefined, undefined, undefined, {
        params: paramsRef.current,
        nextToken,
        onPage: (info) => { pageInfo.current = info; },
      });
      setIdeas((current) => appendHistoryPage(current, page));
      setNextToken(pageInfo.current?.nextToken ?? null);
    } catch (requestError) {
      onError(requestError);
    } finally {
      setIdeasLoadingMore(false);
    }
  }, [nextToken, onError, setIdeas]);

  return {
    ideasTotal,
    ideasHasMore: nextToken !== null,
    ideasLoadingMore,
    applyFirstPage,
    loadMoreIdeas,
  };
}
