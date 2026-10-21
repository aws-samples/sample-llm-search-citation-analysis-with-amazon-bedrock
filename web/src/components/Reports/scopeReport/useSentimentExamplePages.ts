import {
  useCallback, useEffect, useState
} from 'react';
import type { ReportScope } from '../../../types';
import type {
  SentimentExample, SentimentExamplesResponse, SentimentLabel
} from '../../../types/domain/sentimentExamples';
import { useSentimentExamples } from '../../../hooks/useSentimentExamples';
import {
  decodeReportScope, encodeReportScope
} from '../../ui/reportScope';

export interface SentimentExamplePages {
  /** The latest page's response (its `total`, `next_token`, scope); `null` before the first one. */
  readonly data: SentimentExamplesResponse | null;
  /** Every page loaded so far, in order. */
  readonly examples: readonly SentimentExample[];
  /** The first page is loading. */
  readonly loading: boolean;
  /** A further page is loading; the pages already loaded stay shown. */
  readonly loadingMore: boolean;
  readonly error: string | null;
  /** Fetches the page `data.next_token` points at and appends it. */
  readonly loadMore: () => void;
}

/**
 * The answers behind one sentiment count, page by page: the first page on
 * mount (and again for a new scope, sentiment or engine), then each page the
 * previous one's `next_token` points at, appended on `loadMore`.
 */
export function useSentimentExamplePages(scope: ReportScope, sentiment: SentimentLabel, provider: string | null): SentimentExamplePages {
  const {
    data, loading, error, fetchSentimentExamples
  } = useSentimentExamples();
  const [examples, setExamples] = useState<readonly SentimentExample[]>([]);
  const [loadingMore, setLoadingMore] = useState(false);
  const scopeKey = encodeReportScope(scope);

  useEffect(() => {
    setLoadingMore(false);
    void fetchSentimentExamples(decodeReportScope(scopeKey), sentiment, provider ?? undefined).then((first) => {
      if (first !== null) setExamples(first.examples);
    });
  }, [scopeKey, sentiment, provider, fetchSentimentExamples]);

  const nextToken = data?.next_token ?? null;
  const loadMore = useCallback(() => {
    if (nextToken === null) return;
    setLoadingMore(true);
    void fetchSentimentExamples(decodeReportScope(scopeKey), sentiment, provider ?? undefined, undefined, nextToken).then((next) => {
      if (next === null) return;
      setExamples((shown) => [...shown, ...next.examples]);
      setLoadingMore(false);
    });
  }, [nextToken, scopeKey, sentiment, provider, fetchSentimentExamples]);

  return {
    data,
    examples,
    loading: loading && !loadingMore,
    loadingMore: loading && loadingMore,
    error,
    loadMore,
  };
}
