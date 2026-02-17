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
import type { BrandMentionsResponse } from '../types';

function isBrandMentionsResponse(data: unknown): data is BrandMentionsResponse {
  return typeof data === 'object' && data !== null && 'aggregated' in data;
}

/**
 * Hook for fetching brand mentions data for a keyword.
 * Automatically fetches data when keyword changes and supports filtering by classification.
 * 
 * @param keyword - The keyword to fetch brand mentions for (null to skip fetch)
 * @param classificationFilter - Optional filter for brand classification ('first_party', 'competitor', 'other')
 * @returns Object containing:
 * - `data` - Brand mentions response data
 * - `loading` - Whether data is being fetched
 * - `error` - Error message if fetch failed
 * 
 * @example
 * ```tsx
 * const { data, loading, error } = useBrandMentions('best hotels in paris');
 * 
 * if (loading) return <Spinner />;
 * if (error) return <Error message={error} />;
 * 
 * return <BrandTable brands={data?.aggregated.brands} />;
 * ```
 */
export const useBrandMentions = (keyword: string | null, classificationFilter: string | null = null) => {
  const [data, setData] = useState<BrandMentionsResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!keyword) {
      setData(null);
      return;
    }

    const controller = new AbortController();

    const fetchBrandMentions = async () => {
      setLoading(true);
      setError(null);

      try {
        const baseUrl = `${API_BASE_URL}/brand-mentions?keyword=${encodeURIComponent(keyword)}`;
        const url = classificationFilter
          ? `${baseUrl}&classification=${encodeURIComponent(classificationFilter)}`
          : baseUrl;

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
  }, [keyword, classificationFilter]);

  return {
    data,
    loading,
    error 
  };
};
