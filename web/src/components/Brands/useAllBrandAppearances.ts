import {
  useCallback, useState
} from 'react';
import type { BrandAppearance } from '../../types';
import {
  fetchBrandAppearances, type BrandAppearancesRequest
} from '../../api/brandMentions';
import { getErrorMessage } from '../../infrastructure';

type AllAppearancesState =
  | { status: 'preview' }
  | { status: 'loading' }
  | {
    status: 'loaded';
    appearances: BrandAppearance[]
  }
  | {
    status: 'error';
    message: string
  };

/**
 * The appearances a brand drill-down lists: the summary's preview until the
 * reader asks for all of them, then every `view=appearances` page of that
 * brand (`request` narrowed to `brand`).
 */
export function useAllBrandAppearances(
  preview: BrandAppearance[],
  brand: string,
  request: BrandAppearancesRequest | null
) {
  const [state, setState] = useState<AllAppearancesState>({ status: 'preview' });

  const loadAll = useCallback(async () => {
    if (request === null) return;
    setState({ status: 'loading' });
    try {
      const appearances = await fetchBrandAppearances({
        ...request,
        brand 
      });
      setState({
        status: 'loaded',
        appearances 
      });
    } catch (error: unknown) {
      setState({
        status: 'error',
        message: getErrorMessage(error, 'brands') 
      });
    }
  }, [request, brand]);

  return {
    appearances: state.status === 'loaded' ? state.appearances : preview,
    loading: state.status === 'loading',
    error: state.status === 'error' ? state.message : null,
    loaded: state.status === 'loaded',
    loadAll,
  };
}
