import {
  useCallback, useEffect, useMemo, useRef, useState
} from 'react';
import type {
  BrandAppearance, BrandAppearanceRow, BrandAppearancesPage
} from '../../types';
import {
  APPEARANCES_PAGING, appearancesListRequest, fetchFirstAppearancesPage, type BrandAppearancesRequest
} from '../../api/brandMentions';
import { isAppearanceRow } from '../../api/brandMentionsDecoders';
import {
  getErrorMessage, isAbortError
} from '../../infrastructure';
import {
  useScopedList, type ScopedList
} from '../../hooks/useScopedList';

export interface BrandAppearancePages {
  /** The summary's preview until the first page is read, then every page read so far. */
  readonly appearances: readonly BrandAppearance[];
  /** The pages read so far (load more, total, restart); `null` while the preview is shown. */
  readonly list: ScopedList<BrandAppearanceRow> | null;
  /** Reads the first page; `undefined` once it is read or without a request to read it with. */
  readonly showMore: (() => Promise<void>) | undefined;
  readonly loading: boolean;
  readonly error: string | null;
}

/**
 * The appearances a brand drill-down lists: the summary's preview until the reader asks for
 * more, then the brand's `view=appearances` pages (`request` narrowed to `brand`), one page per
 * "Load more" so a brand with hundreds of thousands of appearances never loads at once.
 */
export function useAllBrandAppearances(
  preview: BrandAppearance[],
  brand: string,
  request: BrandAppearancesRequest | null
): BrandAppearancePages {
  const brandRequest = useMemo(() => (request === null ? null : {
    ...request,
    brand,
  }), [request, brand]);
  const listRequest = useMemo(() => (brandRequest === null ? null : appearancesListRequest(brandRequest)), [brandRequest]);
  const [firstPage, setFirstPage] = useState<BrandAppearancesPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const list = useScopedList(firstPage, listRequest, APPEARANCES_PAGING, isAppearanceRow);

  useEffect(() => {
    controllerRef.current?.abort();
    setFirstPage(null);
    setError(null);
    setLoading(false);
  }, [brandRequest]);

  useEffect(() => () => controllerRef.current?.abort(), []);

  const showMore = useCallback(async () => {
    if (brandRequest === null) return;
    const controller = new AbortController();
    controllerRef.current = controller;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchFirstAppearancesPage(brandRequest, controller.signal);
      if (!controller.signal.aborted) setFirstPage(page);
    } catch (pageError: unknown) {
      if (!isAbortError(pageError)) setError(getErrorMessage(pageError, 'brands'));
    } finally {
      if (controllerRef.current === controller) setLoading(false);
    }
  }, [brandRequest]);

  return {
    appearances: firstPage === null ? preview : list.items,
    list: firstPage === null ? null : list,
    showMore: firstPage === null && brandRequest !== null ? showMore : undefined,
    loading,
    error,
  };
}
