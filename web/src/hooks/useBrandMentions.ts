import {
  useState, useEffect 
} from 'react';
import {
  API_BASE_URL,
  authenticatedFetch,
  getErrorMessage,
  isAbortError,
  ApiRequestError,
} from '../infrastructure';
import type {
  BrandMentionsResponse, ReportScope
} from '../types';
import {
  decodeReportScope, encodeReportScope, reportScopeParams
} from '../components/ui/reportScope';

function isBrandMentionsResponse(data: unknown): data is BrandMentionsResponse {
  return typeof data === 'object' && data !== null && 'aggregated' in data;
}

/**
 * Hook for fetching brand mentions data for a report scope (one keyword, a
 * keyword group, or every keyword). Automatically fetches when the scope
 * changes and supports filtering by classification.
 * 
 * @param scope - What to fetch brand mentions for (null to skip fetch)
 * @param classificationFilter - Optional filter for brand classification ('first_party', 'competitor', 'other')
 * @returns Object containing:
 * - `data` - Brand mentions response data
 * - `loading` - Whether data is being fetched
 * - `error` - Error message if fetch failed
 * 
 * @example
 * ```tsx
 * const { data, loading, error } = useBrandMentions({ kind: 'keyword', keyword: 'best hotels in paris' });
 * 
 * if (loading) return <Spinner />;
 * if (error) return <Error message={error} />;
 * 
 * return <BrandTable brands={data?.aggregated.brands} />;
 * ```
 */
export const useBrandMentions = (scope: ReportScope | null, classificationFilter: string | null = null, queryPromptId: string | null = null) => {
  const [data, setData] = useState<BrandMentionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The scope object is rebuilt by callers on every render; key the effect on
  // its encoded form so a same-value scope does not refetch.
  const scopeKey = scope === null ? null : encodeReportScope(scope);

  useEffect(() => {
    if (scopeKey === null) {
      setData(null);
      return;
    }

    const controller = new AbortController();

    const fetchBrandMentions = async () => {
      setLoading(true);
      setError(null);

      try {
        const params = new URLSearchParams(reportScopeParams(decodeReportScope(scopeKey)));
        if (classificationFilter) params.append('classification', classificationFilter);
        if (queryPromptId) params.append('query_prompt_id', queryPromptId);
        const url = `${API_BASE_URL}/brand-mentions?${params.toString()}`;

        const response = await authenticatedFetch(url, { signal: controller.signal });

        if (!response.ok) {
          throw new ApiRequestError(`HTTP ${response.status}: ${response.statusText}`, response.status);
        }

        const json: unknown = await response.json();
        if (!isBrandMentionsResponse(json)) {
          throw new ApiRequestError('Invalid response format');
        }
        setData(json);
      } catch (err) {
        if (isAbortError(err)) {
          return;
        }
        const message = getErrorMessage(err, 'brands');
        setError(message);
        console.error('[brands] Error fetching brand mentions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchBrandMentions();

    return () => controller.abort();
  }, [scopeKey, classificationFilter, queryPromptId]);

  return {
    data,
    loading,
    error 
  };
};
